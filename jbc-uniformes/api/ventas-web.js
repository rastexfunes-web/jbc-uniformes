// Lista las ventas de la tienda pagadas con Mercado Pago, para la solapa
// "Ventas Web" de Rastex Gestión. Mercado Pago es la fuente: aparece cada pago
// aprobado aunque el cliente no haya vuelto a la tienda.
//
// Solo responde a Marcelo y Luciana logueados en Rastex Gestión: se verifica su sesión
// de Firebase (proyecto pos-rastex) con el token que manda la app.

const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');

const POS_PROJECT_ID = 'pos-rastex';
const UID_DUENO = 'H2y2uvY7g0d4vpZgOH6MERC6mEI2'; // Marcelo
const UIDS_PERMITIDOS = [UID_DUENO, 'QojAJ4SZlzPjPGe9N9BJmVwdAIt1']; // + Luciana (sin ver lo que te queda)
const ORIGENES = [
  'https://rastex-gestion.com.ar',
  'https://www.rastex-gestion.com.ar',
  'https://pos-rastex.vercel.app',
  'http://localhost:5173'
];

const posApp = admin.apps.find(a => a && a.name === 'pos') ||
  admin.initializeApp({ projectId: POS_PROJECT_ID }, 'pos');

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 10000 }
});

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ORIGENES.includes(origin) || /^https:\/\/pos-rastex[\w-]*\.vercel\.app$/.test(origin || '')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 1) ¿Es Marcelo?
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Falta iniciar sesión' });
  let esDueno = false;
  try {
    const decoded = await posApp.auth().verifyIdToken(token);
    if (!UIDS_PERMITIDOS.includes(decoded.uid)) return res.status(403).json({ error: 'Sin permiso' });
    esDueno = decoded.uid === UID_DUENO;
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida, volvé a entrar' });
  }
  if (!process.env.MP_ACCESS_TOKEN) return res.status(500).json({ error: 'Falta MP_ACCESS_TOKEN en Vercel' });

  // 2) Pagos aprobados de la tienda (external_reference "UCR-...")
  const dias = Math.min(365, Math.max(1, parseInt(req.query.dias, 10) || 90));
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const hasta = new Date().toISOString();

  try {
    const payment = new Payment(mp);
    const ventas = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const r = await payment.search({
        options: {
          sort: 'date_approved', criteria: 'desc', range: 'date_approved',
          begin_date: desde, end_date: hasta, status: 'approved', limit: 100, offset
        }
      });
      const lista = r.results || [];
      for (const p of lista) {
        const ref = p.external_reference || '';
        if (!ref.startsWith('UCR-')) continue; // solo la tienda de uniformes
        let pedido = null;
        try { pedido = p.metadata && p.metadata.pedido ? JSON.parse(p.metadata.pedido) : null; } catch (e) {}
        ventas.push({
          paymentId: String(p.id),
          ref,
          fechaAprobado: p.date_approved,
          pagado: p.transaction_amount,
          neto: esDueno && p.transaction_details ? p.transaction_details.net_received_amount : null,
          cuotas: p.installments,
          medio: p.payment_method_id,
          pedido
        });
      }
      if (lista.length < 100) break;
    }
    return res.status(200).json({ ventas, dias });
  } catch (e) {
    console.error('ventas-web:', e);
    return res.status(500).json({ error: e.message || 'No se pudo consultar Mercado Pago' });
  }
};
