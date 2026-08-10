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

function parseSchedule(html) {
  const games = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const row = rowMatch[1];
    const dateMatch = row.match(/(\d{1,2}\/\d{1,2})/);
    if (!dateMatch) continue;
    const timeMatch = row.match(/(\d{1,2}:\d{2}(?:am|pm))/i);
    const haMatch = row.match(/\b(vs|@)\b/i);
    if (!haMatch) continue;
    const oppMatch = row.match(/(?:vs|@)[^<]*(?:<[^>]+>)*([A-Z][^<\n]{2,40}?)(?:<\/a>|\*)/i)
      || row.match(/(?:vs|@)\s*(?:<[^>]+>\s*)*([A-Z][A-Za-z\s]+?)(?:\s*<|\s*\*|\s*\[)/);
    if (!oppMatch) continue;
    const resultMatch = row.match(/\b([WLT])\s+(\d{1,2}-\d{1,2})\b/i);
    const isRegion = row.includes('\\*') || /region/i.test(row);
    const [, m, d] = dateMatch[0].match(/(\d+)\/(\d+)/);
    const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    games.push({
      date: `${months[parseInt(m)]} ${parseInt(d)}`,
      time: timeMatch ? timeMatch[1].toUpperCase().replace('AM',' AM').replace('PM',' PM') : 'TBD',
      homeAway: haMatch[1].toUpperCase() === 'VS' ? 'HOME' : 'AWAY',
      opponent: oppMatch[1].trim().replace(/\s+/g,' '),
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
    const row = rowMatch[1];
    const numMatch = row.match(/<td[^>]*>\s*(\d{1,2})\s*<\/td>/);
    if (!numMatch) continue;
    const nameMatch = row.match(/\/athlete\/[\s\S]*?>([^<]{3,40})<\/a>/i)
      || row.match(/<td[^>]*>\s*<a[^>]*>([A-Z][^<]{2,40})<\/a>/);
    if (!nameMatch) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m =>
      m[1].replace(/<[^>]+>/g,'').trim()
    );
    players.push({ number: numMatch[1], name: nameMatch[1].trim(), position: cells[2] || '', grade: cells[3] || '' });
  }
  return players;
}

function parseStaff(html) {
  const staff = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const row = rowMatch[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m =>
      m[1].replace(/<[^>]+>/g,'').trim()
    );
    if (cells.length >= 2 && cells[0].length > 2 && /coach/i.test(cells[1])) {
      staff.push({ name: cells[0], role: cells[1] });
    }
  }
  const seen = new Set();
  return staff.filter(s => { const k = s.name+s.role; if(seen.has(k))return false; seen.add(k); return true; });
}

function parseNews(html) {
  const articles = [];
  // Match news article links with title and date
  const pattern = /•([\w]+ \d+, \d{4})\s*\n+\[([^\]]+)\]\((https:\/\/www\.maxpreps\.com\/news\/[^)]+)\)/g;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const date  = m[1].trim();
    const title = m[2].replace(/\s{2,}/g,' ').trim();
    const url   = m[3];
    // Skip duplicates and previews if we already have 3 recaps
    const isRecap   = /recap/i.test(title);
    const isPreview = /preview/i.test(title);
    const tag = isRecap ? '⚽ Game Recap' : isPreview ? '👀 Preview' : '📣 News';
    if (!articles.find(a => a.url === url)) {
      articles.push({ date, title, url, tag });
    }
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
