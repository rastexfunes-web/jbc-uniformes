const { MercadoPagoConfig, Preference } = require('mercadopago');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 }
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
          id: String(item.id),
          title: `${item.name} - Talle ${item.size}`,
          quantity: Number(item.qty),
          unit_price: Number(item.price),
          currency_id: 'ARS',
          category_id: 'fashion'
        })),
        payer: {
          name: payer.name,
          phone: { area_code: '341', number: payer.phone }
        },
        external_reference: `JBC-${String(orderNumber).padStart(4, '0')}`,
        notification_url: `https://jbc-uniformes.vercel.app/api/webhook`,
        back_urls: {
          success: `https://jbc-uniformes.vercel.app`,
          failure: `https://jbc-uniformes.vercel.app`,
          pending: `https://jbc-uniformes.vercel.app`
        },
        auto_return: 'approved',
        statement_descriptor: 'JBC Uniformes',
        expires: false
      }
    });

    return res.status(200).json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });

  } catch (error) {
    console.error('MP Error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message, detail: JSON.stringify(error) });
  }
};
