const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

exports.handler = async () => {
  const SHEET_CSV_URL = process.env.UPDATES_SHEET_URL;

  if (!SHEET_CSV_URL) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ active: false, message: '' }),
    };
  }

  try {
    const csv = await fetchUrl(SHEET_CSV_URL);
    const lines = csv.trim().split('\n').filter(l => l.trim());
    // Skip header row, read first data row: active, message
    if (lines.length < 2) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ active: false, message: '' }) };
    }
    const [activeVal, ...rest] = lines[1].split(',');
    const message = rest.join(',').replace(/^"|"$/g, '').trim();
    const active = activeVal.trim().toUpperCase() === 'TRUE';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ active, message }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ active: false, message: '', error: err.message }),
    };
  }
};
