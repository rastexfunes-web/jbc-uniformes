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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(500).json({ error: 'Falta MP_ACCESS_TOKEN en Vercel' });

  try {
    const { order } = req.body || {};
    if (!order || !Array.isArray(order.items) || !order.items.length) {
      return res.status(400).json({ error: 'Pedido vacío' });
    }

    const items = order.items.map(i => ({
      id: String(i.id),
      title: `${i.name} - Talle ${i.size}`.slice(0, 250),
      quantity: Math.max(1, Math.round(Number(i.qty) || 1)),
      unit_price: Math.max(1, Number(i.price) || 0),
      currency_id: 'ARS',
      category_id: 'fashion'
    }));

    // Vuelve al mismo dominio desde el que se compró (o al principal)
    const origen = ORIGENES_OK.includes(req.headers.origin) ? req.headers.origin : SITIO;

    // Copia compacta del pedido, por si el cliente vuelve desde otro navegador
    const pedido = JSON.stringify({
      numero: order.numero, ref: order.ref, fecha: order.fecha, hora: order.hora,
      nombre: String(order.nombre || '').slice(0, 80), telefono: String(order.telefono || '').slice(0, 30),
      metodoPago: 'mp', total: order.total,
      items: order.items.map(i => ({ id: i.id, name: i.name, size: i.size, qty: i.qty, price: i.price }))
    });

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items,
        payer: { name: String(order.nombre || '') },
        external_reference: String(order.ref || ''),
        metadata: { pedido },
        notification_url: `${SITIO}/api/webhook`,
        back_urls: { success: origen, failure: origen, pending: origen },
        auto_return: 'approved',
        // Solo pagos que se acreditan al momento (sin Rapipago / Pago Fácil)
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
        statement_descriptor: 'UNIFORMES ROSARIO'
      }
    });

    return res.status(200).json({ id: result.id, init_point: result.init_point });
  } catch (error) {
    console.error('MP Error:', error);
    return res.status(500).json({ error: error.message || 'Error de Mercado Pago' });
  }
};
