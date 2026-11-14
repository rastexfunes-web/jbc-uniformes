const { MercadoPagoConfig, Preference } = require('mercadopago');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 8000 }
});

const SITIO = 'https://www.uniformescolegiorosario.com.ar';
const ORIGENES_OK = [
  'https://www.uniformescolegiorosario.com.ar',
  'https://uniformescolegiorosario.com.ar'
];

// Firestore de la tienda (mismo acceso público que usa la página)
const FS_PROJECT = 'colegio-rosario';
const FS_KEY = 'AIzaSyBOAf9OF9JaRHswEv6naZHvWs9nfhG1R1Y';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;
const TALLES_ADULTOS = ['16', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const NUMERO_BASE = 1000; // los pedidos web arrancan en el N° 1001

// Convierte un valor de la API REST de Firestore a JS
function fsVal(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsVal);
  if ('mapValue' in v) return fsDoc(v.mapValue.fields || {});
  return null;
}
function fsDoc(fields) {
  const o = {};
  for (const k of Object.keys(fields || {})) o[k] = fsVal(fields[k]);
  return o;
}

// Lee una colección entera: { idDelDocumento: datos }
async function leerColeccion(nombre) {
  const out = {};
  let pageToken = '';
  for (let i = 0; i < 20; i++) {
    const url = `${FS_BASE}/${nombre}?pageSize=300&key=${FS_KEY}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Firestore ${nombre}: HTTP ${r.status}`);
    const d = await r.json();
    for (const doc of d.documents || []) {
      const id = doc.name.split('/').pop();
      out[id] = fsDoc(doc.fields);
    }
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  return out;
}

// Contador único de pedidos (suma 1 de forma atómica en Firestore)
async function siguienteNumero() {
  const r = await fetch(`${FS_BASE}:commit?key=${FS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        transform: {
          document: `projects/${FS_PROJECT}/databases/(default)/documents/config/contadorPedidosWeb`,
          fieldTransforms: [{ fieldPath: 'ultimo', increment: { integerValue: '1' } }]
        }
      }]
    })
  });
  if (!r.ok) throw new Error('contador HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  const n = Number(d.writeResults[0].transformResults[0].integerValue);
  if (!n) throw new Error('contador sin valor');
  return NUMERO_BASE + n;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(500).json({ error: 'Falta MP_ACCESS_TOKEN en Vercel' });

  try {
    const { order } = req.body || {};
    if (!order || !Array.isArray(order.items) || !order.items.length || order.items.length > 60) {
      return res.status(400).json({ error: 'Pedido vacío' });
    }
    const nombre = String(order.nombre || '').trim().slice(0, 80);
    const telefono = String(order.telefono || '').trim().slice(0, 30);
    if (!nombre || !telefono) return res.status(400).json({ error: 'Faltan nombre o teléfono' });

    // 1) Precios reales desde Firestore (no los que manda el navegador)
    let productos, libreria;
    try {
      [productos, libreria] = await Promise.all([leerColeccion('productos'), leerColeccion('libreria')]);
    } catch (e) {
      console.error('No se pudieron leer los precios:', e);
      return res.status(503).json({ error: 'precios', mensaje: '⚠️ No pudimos verificar los precios. Probá de nuevo en un rato.' });
    }

    const items = [];
    let cambioPrecio = false;
    for (const i of order.items) {
      const qty = Math.round(Number(i.qty));
      if (!(qty >= 1 && qty <= 99)) return res.status(400).json({ error: 'Cantidad inválida' });
      const idTxt = String(i.id);
      const size = String(i.size || '');
      let prod, precio;
      if (idTxt.startsWith('lib-')) {
        prod = libreria[idTxt.slice(4)];
        precio = prod && Number(prod.price);
      } else {
        prod = productos[idTxt];
        precio = prod && Number(TALLES_ADULTOS.includes(size) ? (prod.priceAdult || prod.price) : prod.price);
      }
      if (!prod || !(precio > 0)) {
        return res.status(409).json({ error: 'producto', mensaje: '⚠️ Un producto del carrito ya no está disponible. Recargá la página.' });
      }
      if (Math.round(Number(i.price)) !== Math.round(precio)) cambioPrecio = true;
      items.push({ id: i.id, name: String(prod.name || i.name).slice(0, 120), size: size.slice(0, 10), qty, price: precio });
    }
    if (cambioPrecio) {
      return res.status(409).json({ error: 'precio', mensaje: '⚠️ Los precios se actualizaron. Recargá la página y armá el pedido de nuevo.' });
    }
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);

    // 2) Número de pedido único
    let numero;
    try {
      numero = await siguienteNumero();
    } catch (e) {
      console.error('Contador de pedidos:', e); // no frenamos la venta por esto
      numero = 'W' + String(Date.now()).slice(-6);
    }
    const ref = 'UCR-' + String(numero).padStart(4, '0') + '-' + Date.now().toString(36).toUpperCase();

    const pedido = {
      numero, ref, fecha: String(order.fecha || '').slice(0, 20), hora: String(order.hora || '').slice(0, 10),
      nombre, telefono, metodoPago: 'mp', total, items
    };

    // 3) Preferencia de Mercado Pago
    const origen = ORIGENES_OK.includes(req.headers.origin) ? req.headers.origin : SITIO;
    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: items.map(i => ({
          id: String(i.id),
          title: `${i.name} - Talle ${i.size}`.slice(0, 250),
          quantity: i.qty,
          unit_price: i.price,
          currency_id: 'ARS',
          category_id: 'fashion'
        })),
        payer: { name: nombre },
        external_reference: ref,
        metadata: { pedido: JSON.stringify(pedido) },
        notification_url: `${SITIO}/api/webhook`,
        back_urls: { success: origen, failure: origen, pending: origen },
        auto_return: 'approved',
        // Solo pagos que se acreditan al momento (sin Rapipago / Pago Fácil)
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
        statement_descriptor: 'UNIFORMES ROSARIO'
      }
    });

    return res.status(200).json({ id: result.id, init_point: result.init_point, pedido });
  } catch (error) {
    console.error('MP Error:', error);
    return res.status(500).json({ error: error.message || 'Error de Mercado Pago' });
  }
};
