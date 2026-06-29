const { MercadoPagoConfig, Preference } = require('mercadopago');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { items, payer, orderNumber } = req.body;

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: items.map(item => ({
          title: `${item.name} - Talle ${item.size}`,
          quantity: item.qty,
          unit_price: item.price,
          currency_id: 'ARS',
        })),
        payer: {
          name: payer.name,
          phone: { number: payer.phone },
        },
        external_reference: `JBC-${String(orderNumber).padStart(4, '0')}`,
        notification_url: `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/webhook`,
        back_urls: {
          success: `${process.env.SITE_URL}/gracias.html`,
          failure: `${process.env.SITE_URL}`,
          pending: `${process.env.SITE_URL}/gracias.html`,
        },
        auto_return: 'approved',
        statement_descriptor: 'JBC Uniformes',
      }
    });

    return res.status(200).json({
      id: result.id,
      init_point: result.init_point,
    });

  } catch (error) {
    console.error('MP Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
