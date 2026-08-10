const https = require('https');

const URLS = {
  schedule: 'https://www.maxpreps.com/ga/dalton/dalton-catamounts/soccer/girls/spring/schedule/',
  roster:   'https://www.maxpreps.com/ga/dalton/dalton-catamounts/soccer/girls/spring/roster/',
  staff:    'https://www.maxpreps.com/ga/dalton/dalton-catamounts/soccer/girls/spring/staff/',
  news:     'https://www.maxpreps.com/ga/dalton/dalton-catamounts/soccer/girls/spring/media/news/',
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCells(row) {
  const cells = [];
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = cellPattern.exec(row)) !== null) {
    cells.push(m[1]);
  }
  return cells;
}

function parseSchedule(html) {
  const games = [];
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const cells = getCells(rowMatch[1]);
    if (cells.length < 2) continue;

    // Cell 0: date + time  e.g. "2/9 5:30pm"
    const dateText = stripTags(cells[0]);
    const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})/);
    if (!dateMatch) continue;
    const timeMatch = dateText.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i);

    // Cell 1: opponent — look for vs or @ then extract team name after any images
    const oppRaw = cells[1];
    const haMatch = oppRaw.match(/\b(vs|@)\b/i);
    if (!haMatch) continue;

    // Remove img tags, then strip remaining tags to get team name
    const oppNoImg = oppRaw.replace(/<img[^>]*>/gi, '');
    // Get text after "vs" or "@"
    const oppText = stripTags(oppNoImg);
    const oppNameMatch = oppText.match(/(?:vs|@)\s*(.+)/i);
    if (!oppNameMatch) continue;
    let opponent = oppNameMatch[1].trim()
      .replace(/\*/g, '')
      .replace(/Preview.*$/i, '')
      .replace(/Watch.*$/i, '')
      .trim();
    if (!opponent || opponent.length < 2) continue;

    // Check for region game marker
    const isRegion = oppRaw.includes('*') || /\*/.test(cells[1]);

    // Cell 2 or further: result
    const resultText = cells.length > 2 ? stripTags(cells[cells.length - 1]) : '';
    const resultMatch = resultText.match(/\b([WLT])\s+(\d{1,2}-\d{1,2})\b/i);

    const [, m, d] = dateMatch;
    games.push({
      date: `${months[parseInt(m)]} ${parseInt(d)}`,
      time: timeMatch ? timeMatch[1].toUpperCase().replace(/\s+/,'') : 'TBD',
      homeAway: haMatch[1].toLowerCase() === 'vs' ? 'HOME' : 'AWAY',
      opponent,
      result: resultMatch ? { outcome: resultMatch[1].toUpperCase(), score: resultMatch[2] } : null,
      isRegion,
    });
  }
  return games;
}

function parseRoster(html) {
  const players = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const cells = getCells(rowMatch[1]).map(stripTags);
    const numMatch = cells[0] && cells[0].match(/^\d{1,2}$/);
    if (!numMatch) continue;
    if (!cells[1] || cells[1].length < 3) continue;
    players.push({ number: cells[0], name: cells[1], position: cells[2] || '', grade: cells[3] || '' });
  }
  return players;
}

function parseStaff(html) {
  const staff = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const cells = getCells(rowMatch[1]).map(stripTags);
    if (cells.length >= 2 && cells[0].length > 2 && /coach/i.test(cells[1])) {
      staff.push({ name: cells[0], role: cells[1] });
    }
  }
  const seen = new Set();
  return staff.filter(s => { const k = s.name+s.role; if(seen.has(k))return false; seen.add(k); return true; });
}

function parseNews(html) {
  const articles = [];
  const pattern = /•([\w]+ \d+, \d{4})\s*\n+\[([^\]]+)\]\((https:\/\/www\.maxpreps\.com\/news\/[^)]+)\)/g;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const date  = m[1].trim();
    const title = m[2].replace(/\s{2,}/g,' ').trim();
    const url   = m[3];
    const isRecap   = /recap/i.test(title);
    const isPreview = /preview/i.test(title);
    const tag = isRecap ? '⚽ Game Recap' : isPreview ? '👀 Preview' : '📣 News';
    if (!articles.find(a => a.url === url)) articles.push({ date, title, url, tag });
    if (articles.length >= 3) break;
  }
  return articles;
}

exports.handler = async (event) => {
  const type = event.queryStringParameters?.type || 'schedule';
  try {
    const html = await fetchUrl(URLS[type] || URLS.schedule);
    let data;
    if      (type === 'roster') data = parseRoster(html);
    else if (type === 'staff')  data = parseStaff(html);
    else if (type === 'news')   data = parseNews(html);
    else                        data = parseSchedule(html);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ data, updated: new Date().toISOString(), source: 'MaxPreps' }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
