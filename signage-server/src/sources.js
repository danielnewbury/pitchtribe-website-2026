// Extra live data sources for widgets. Every source here is free to use without an
// API key and allows commercial use (with attribution where the licence asks for
// it — each result carries a `credit` line that screens display). See DATA_SOURCES.md.
//
// Parsers are pure functions (exported for tests); `createSources(ctx)` wires them
// to the widget cache (`ctx.remote`) and HTTP helpers.

// ------------------------------------------------------------- text helpers
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', pound: '£', euro: '€' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
/** Markup -> plain text (CDATA unwrapped, tags removed, entities decoded, whitespace collapsed). */
export function plainText(s) {
  const unwrapped = String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(decodeEntities(unwrapped.replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------- RSS / Atom feeds
export function parseFeed(xml) {
  const text = String(xml ?? '');
  const atom = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text);
  const tag = (block, names) => {
    for (const name of names) {
      const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
      if (m) return plainText(m[1]);
    }
    return '';
  };
  const itemRe = atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const blocks = text.match(itemRe) ?? [];
  const head = blocks.length ? text.slice(0, text.indexOf(blocks[0])) : text;
  const items = blocks
    .map((b) => {
      const when = tag(b, ['pubDate', 'published', 'updated', 'dc:date']);
      const date = when ? new Date(when) : null;
      return { title: tag(b, ['title']), date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null };
    })
    .filter((i) => i.title);
  return { title: tag(head, ['title']), items };
}

// ------------------------------------------------------------ iCalendar (ICS)
/** Offset (ms) of a time zone from UTC at a given instant. */
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
/** Wall-clock time in `tz` -> UTC instant. */
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz); // second pass handles DST edges
  return new Date(t);
}
const unescapeIcs = (s) => String(s ?? '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

export function parseIcs(text, { tz = 'Europe/London' } = {}) {
  const lines = String(text ?? '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let calName = '';
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    const prop = name.toUpperCase();
    if (!ev) {
      if (prop === 'X-WR-CALNAME') calName = unescapeIcs(value);
      continue;
    }
    const paramMap = Object.fromEntries(params.map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
    if (prop === 'SUMMARY') ev.title = unescapeIcs(value);
    else if (prop === 'LOCATION') ev.location = unescapeIcs(value);
    else if (prop === 'STATUS') ev.status = value.toUpperCase();
    else if (prop === 'RRULE') ev.recurring = true;
    else if (prop === 'DTSTART') {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
      if (!m) continue;
      const [, y, mo, d, h, mi, s, z] = m;
      if (h === undefined || paramMap.VALUE === 'DATE') {
        ev.allDay = true;
        ev.date = `${y}-${mo}-${d}`;
        ev.start = zonedToUtc(+y, +mo, +d, 0, 0, 0, tz);
      } else if (z) {
        ev.start = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
      } else {
        let zone = (paramMap.TZID || '').replace(/^"|"$/g, '') || tz;
        try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); } catch { zone = tz; }
        ev.start = zonedToUtc(+y, +mo, +d, +h, +mi, +s, zone);
      }
    }
  }
  return {
    title: calName,
    events: events.filter((e) => e.start && e.title && e.status !== 'CANCELLED'),
  };
}

// ------------------------------------------------- sun and moon (computed)
const rad = Math.PI / 180;
/**
 * Sunrise/sunset (UTC Date or null) for a calendar date at lat/lon, using the
 * classic "Almanac for Computers" sunrise equation (accurate to a minute or two).
 */
export function sunTimes(y, m, d, lat, lon) {
  const N = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);
  const lngHour = lon / 15;
  const calc = (rising) => {
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634;
    L = ((L % 360) + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = ((RA % 360) + 360) % 360;
    RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null; // polar night / midnight sun
    const H = (rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
    const T = H + RA - 0.06571 * t - 6.622;
    const UT = (((T - lngHour) % 24) + 24) % 24;
    return new Date(Date.UTC(y, m - 1, d) + UT * 3_600_000);
  };
  let rise = calc(true);
  let set = calc(false);
  // Keep both on the requested UTC day's local evening (handles far-west longitudes).
  if (rise && set && set < rise) set = new Date(set.getTime() + 86_400_000);
  return { sunrise: rise, sunset: set };
}

const SYNODIC = 29.530588853;
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
export function moonPhase(date = new Date()) {
  const age = ((((date.getTime() - NEW_MOON_REF) / 86_400_000) % SYNODIC) + SYNODIC) % SYNODIC;
  const illumination = Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2) * 100);
  const names = [
    ['New moon', '🌑'], ['Waxing crescent', '🌒'], ['First quarter', '🌓'], ['Waxing gibbous', '🌔'],
    ['Full moon', '🌕'], ['Waning gibbous', '🌖'], ['Last quarter', '🌗'], ['Waning crescent', '🌘'],
  ];
  const index = Math.round((age / SYNODIC) * 8) % 8;
  const [name, emoji] = names[index];
  return { age: Math.round(age * 10) / 10, illumination, name, emoji, index };
}

// ------------------------------------------------------- MET Norway weather
/** MET Norway symbol_code (e.g. "lightrainshowers_day") -> description + icon. */
export function describeMetSymbol(code = '') {
  const r = describeMetSymbolText(code);
  const t = r.text.toLowerCase();
  const cond = /thunder/.test(t) ? 'thunder' : /sleet/.test(t) ? 'sleet' : /snow showers/.test(t) ? 'snowshowers' : /snow/.test(t) ? 'snow'
    : /showers/.test(t) ? 'showers' : /heavy rain/.test(t) ? 'heavyrain' : /light rain/.test(t) ? 'lightrain' : /rain/.test(t) ? 'rain'
      : t === 'fog' ? 'fog' : t === 'cloudy' ? 'cloudy' : t === 'partly cloudy' ? 'partly' : t === 'fair' ? 'fair' : t === 'clear sky' ? 'clear' : '';
  return { ...r, cond };
}
function describeMetSymbolText(code = '') {
  const c = String(code);
  const night = c.endsWith('_night');
  const base = c.replace(/_(day|night|polartwilight)$/, '');
  const intensity = base.startsWith('light') ? 'Light ' : base.startsWith('heavy') ? 'Heavy ' : '';
  const core = base.replace(/^(light|heavy)(ss)?/, '');
  if (/thunder/.test(core)) return { text: 'Thunderstorm', icon: '⛈️' };
  if (/sleet/.test(core)) return { text: `${intensity}sleet`.replace(/^./, (x) => x.toUpperCase()), icon: '🌨️' };
  if (/snowshowers/.test(core)) return { text: `${intensity}snow showers`.replace(/^./, (x) => x.toUpperCase()), icon: '🌨️' };
  if (/snow/.test(core)) return { text: `${intensity}snow`.replace(/^./, (x) => x.toUpperCase()), icon: '❄️' };
  if (/rainshowers/.test(core)) return { text: `${intensity}showers`.replace(/^./, (x) => x.toUpperCase()), icon: night ? '🌧️' : '🌦️' };
  if (/rain/.test(core)) return { text: `${intensity}rain`.replace(/^./, (x) => x.toUpperCase()), icon: '🌧️' };
  if (core === 'fog') return { text: 'Fog', icon: '🌫️' };
  if (core === 'cloudy') return { text: 'Cloudy', icon: '☁️' };
  if (core === 'partlycloudy') return { text: 'Partly cloudy', icon: night ? '☁️' : '⛅' };
  if (core === 'fair') return { text: 'Fair', icon: night ? '🌙' : '🌤️' };
  if (core === 'clearsky') return { text: 'Clear sky', icon: night ? '🌙' : '☀️' };
  return { text: 'Unknown', icon: '🌡️' };
}

/** Locationforecast 2.0 "compact" -> the same shape as the Open-Meteo parser. */
export function parseMetForecast(j, { tz = 'Europe/London', windUnit = 'mph' } = {}) {
  const series = j?.properties?.timeseries ?? [];
  if (!series.length) throw new Error('No forecast data');
  const wind = (ms) => Math.round(windUnit === 'kmh' ? ms * 3.6 : ms * 2.23694);
  const dayOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const hourOf = (iso) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
  const now = series[0];
  const nowSym = now.data?.next_1_hours?.summary?.symbol_code ?? now.data?.next_6_hours?.summary?.symbol_code;
  const days = new Map();
  for (const s of series) {
    const key = dayOf(s.time);
    const t = s.data?.instant?.details?.air_temperature;
    let d = days.get(key);
    if (!d) { d = { date: key, max: -Infinity, min: Infinity, rainMm: 0, symbol: null, symbolHourDist: 99 }; days.set(key, d); }
    if (Number.isFinite(t)) { d.max = Math.max(d.max, t); d.min = Math.min(d.min, t); }
    const p1 = s.data?.next_1_hours?.details?.precipitation_amount;
    if (Number.isFinite(p1)) d.rainMm += p1;
    const sym = s.data?.next_6_hours?.summary?.symbol_code ?? s.data?.next_1_hours?.summary?.symbol_code;
    const dist = Math.abs(hourOf(s.time) - 12);
    if (sym && dist < d.symbolHourDist) { d.symbol = sym; d.symbolHourDist = dist; }
  }
  return {
    current: {
      temp: Math.round(now.data?.instant?.details?.air_temperature),
      wind: wind(now.data?.instant?.details?.wind_speed ?? 0),
      ...describeMetSymbol(nowSym),
    },
    days: [...days.values()]
      .filter((d) => Number.isFinite(d.max))
      .map((d) => ({ date: d.date, max: Math.round(d.max), min: Math.round(d.min), rain: null, rainMm: Math.round(d.rainMm * 10) / 10, ...describeMetSymbol(d.symbol) })),
    units: { temp: '°C', wind: windUnit === 'kmh' ? 'km/h' : 'mph' },
  };
}

// --------------------------------------------------------- other JSON feeds
export const BANK_HOLIDAY_DIVISIONS = { 'england-and-wales': 'England and Wales', scotland: 'Scotland', 'northern-ireland': 'Northern Ireland' };
export function parseBankHolidays(j, division, todayKey, limit = 4) {
  const events = j?.[division]?.events ?? [];
  return events
    .filter((e) => e.date >= todayKey)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, limit)
    .map((e) => ({ date: e.date, title: e.title, daysAway: Math.round((Date.parse(`${e.date}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000) }));
}

export function parseFloods(j, limit = 6) {
  return (j?.items ?? [])
    .map((f) => ({
      level: Number(f.severityLevel) || 4,
      severity: f.severity || 'Warning',
      area: f.description || f.eaAreaName || 'Unknown area',
      county: f.floodArea?.county || '',
      raised: f.timeRaised || null,
    }))
    .filter((f) => f.level <= 3) // 4 = warning no longer in force
    .sort((a, b) => a.level - b.level)
    .slice(0, limit);
}

export function parseCarbon({ intensity, generation, regional }) {
  if (regional) {
    const r = regional?.data?.[0];
    const d = r?.data?.[0];
    if (!d) throw new Error('No regional data');
    return { region: r.shortname || r.dnoregion || 'Your region', intensity: d.intensity, mix: sortMix(d.generationmix) };
  }
  const i = intensity?.data?.[0]?.intensity;
  if (!i) throw new Error('No intensity data');
  return { region: 'Great Britain', intensity: i, mix: sortMix(generation?.data?.generationmix) };
}
const sortMix = (mix) => (mix ?? []).filter((m) => m.perc > 0).sort((a, b) => b.perc - a.perc).map((m) => ({ fuel: m.fuel, perc: Math.round(m.perc * 10) / 10 }));

export function parseTfl(j) {
  return (Array.isArray(j) ? j : [])
    .map((l) => {
      const s = (l.lineStatuses ?? []).slice().sort((a, b) => a.statusSeverity - b.statusSeverity)[0] ?? {};
      return { id: l.id, name: l.name, mode: l.modeName, status: s.statusSeverityDescription || 'Unknown', severity: s.statusSeverity ?? 10, reason: s.reason ? plainText(s.reason) : '' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parseQuakes(j, limit = 6) {
  return (j?.features ?? [])
    .map((f) => ({ mag: Math.round((f.properties?.mag ?? 0) * 10) / 10, place: f.properties?.place || 'Unknown location', time: f.properties?.time ? new Date(f.properties.time).toISOString() : null, tsunami: Boolean(f.properties?.tsunami) }))
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
    .slice(0, limit);
}

export function parseRates(j) {
  if (!j?.rates) throw new Error('No rates');
  return { base: j.base, date: j.date, rates: Object.entries(j.rates).map(([code, rate]) => ({ code, rate })) };
}

/** Open Trivia DB (encode=url3986) -> our quiz item shape, options shuffled by `shuffle`. */
export function parseOpenTdb(j, shuffle, topic) {
  if (j?.response_code !== 0) throw new Error(`Open Trivia DB response code ${j?.response_code}`);
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  return (j.results ?? [])
    .filter((r) => r.type === 'multiple' && (r.incorrect_answers ?? []).length === 3)
    .map((r, i) => {
      const right = dec(r.correct_answer);
      const options = shuffle([right, ...r.incorrect_answers.map(dec)], i);
      return { q: dec(r.question), options, answer: options.indexOf(right), topic, difficulty: r.difficulty };
    });
}
export const OPENTDB_CATEGORIES = { sport: [21], 'film-tv': [11, 14], music: [12], geography: [22], culture: [10, 25], mixed: [9] };

/** Wikimedia featured feed -> picture of the day. */
export function parsePotd(j) {
  const img = j?.image;
  if (!img?.thumbnail?.source && !img?.image?.source) throw new Error('No picture of the day');
  // Ask Wikimedia's thumbnailer for a screen-sized version rather than the (often huge) original.
  const thumb = img.thumbnail?.source || '';
  const big = /\/\d+px-/.test(thumb) ? thumb.replace(/\/\d+px-/, '/1920px-') : img.image?.source || thumb;
  return {
    title: plainText(img.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
    description: plainText(img.description?.text || img.description?.html || ''),
    src: big,
    width: img.image?.width ?? img.thumbnail?.width ?? null,
    height: img.image?.height ?? img.thumbnail?.height ?? null,
    artist: plainText(img.artist?.text || img.artist?.html || ''),
    license: img.license?.type || img.license?.code || '',
  };
}

export function parseBirths(j) {
  return (j?.births ?? [])
    .filter((b) => b.text && Number.isFinite(Number(b.year)))
    .map((b) => ({ year: Number(b.year), text: plainText(b.text) }));
}

// --------------------------------------------------------------- transport
/** Huxley2 (JSON proxy for National Rail Darwin) departures board. */
export function parseHuxley(j, limit = 8) {
  return {
    station: j?.locationName || j?.crs || '',
    messages: (j?.nrccMessages ?? []).map((m) => plainText(m.value ?? m.Value ?? '')).filter(Boolean).slice(0, 2),
    services: (j?.trainServices ?? []).slice(0, limit).map((s) => ({
      time: s.std || '',
      expected: s.etd || '',
      platform: s.platform || '',
      destination: (s.destination ?? []).map((d) => d.locationName).filter(Boolean).join(' & '),
      operator: s.operator || '',
      cancelled: Boolean(s.isCancelled) || /cancel/i.test(s.etd || ''),
    })),
  };
}

/** TfL StopPoint arrivals (buses, or trains/tubes at a station). */
export function parseArrivals(j, limit = 8) {
  const list = Array.isArray(j) ? j : [];
  return {
    stop: list[0]?.stationName || '',
    arrivals: list
      .slice()
      .sort((a, b) => (a.timeToStation ?? 0) - (b.timeToStation ?? 0))
      .slice(0, limit)
      .map((a) => ({ line: a.lineName || '', destination: a.destinationName || a.towards || '', minutes: Math.max(0, Math.round((a.timeToStation ?? 0) / 60)), platform: a.platformName || '' })),
  };
}

/** TfL Road corridors (London main roads). */
export function parseRoads(j) {
  const order = { Serious: 0, Severe: 0, Closure: 0, Moderate: 1, Minor: 2, Good: 3 };
  return (Array.isArray(j) ? j : [])
    .map((r) => ({ id: r.id, name: r.displayName || r.id, status: r.statusSeverity || 'Unknown', detail: r.statusSeverityDescription || '' }))
    .sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || a.name.localeCompare(b.name, 'en', { numeric: true }));
}

/** Compass point from (lat1,lon1) to (lat2,lon2). */
function compass(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  const deg = ((Math.atan2(y, x) / rad) + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Bus Open Data Service SIRI-VM (live bus positions, England) -> buses on the
 * requested routes, nearest the ground first.
 */
export function parseSiriVm(xml, { lat, lon, lines = [], now = new Date() } = {}) {
  const tag = (block, name) => {
    const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(block);
    return m ? plainText(m[1]) : '';
  };
  const want = new Set(lines.map((l) => String(l).toUpperCase()));
  const blocks = String(xml ?? '').match(/<(?:\w+:)?VehicleActivity[\s>][\s\S]*?<\/(?:\w+:)?VehicleActivity>/gi) ?? [];
  const seen = new Set();
  return blocks
    .map((b) => {
      const vLat = Number(tag(b, 'Latitude'));
      const vLon = Number(tag(b, 'Longitude'));
      const line = tag(b, 'PublishedLineName') || tag(b, 'LineRef');
      const recorded = Date.parse(tag(b, 'RecordedAtTime'));
      return {
        line,
        operator: tag(b, 'OperatorRef'),
        destination: tag(b, 'DestinationName') || tag(b, 'DestinationRef'),
        origin: tag(b, 'OriginName'),
        vehicle: tag(b, 'VehicleRef'),
        lat: vLat,
        lon: vLon,
        minutesAgo: Number.isFinite(recorded) ? Math.max(0, Math.round((now.getTime() - recorded) / 60_000)) : null,
      };
    })
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon) && (!want.size || want.has(v.line.toUpperCase())))
    .filter((v) => (v.minutesAgo === null || v.minutesAgo <= 15) && !seen.has(`${v.operator}:${v.vehicle}`) && seen.add(`${v.operator}:${v.vehicle}`))
    .map(({ lat: vLat, lon: vLon, ...v }) => ({
      ...v,
      distanceKm: Number.isFinite(lat) ? Math.round(distanceKm(lat, lon, vLat, vLon) * 10) / 10 : null,
      direction: Number.isFinite(lat) ? compass(lat, lon, vLat, vLon) : '',
    }))
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
}

/** adsb.lol (readsb "ac" format) -> aircraft overhead, nearest first. */
export function parseAircraft(j, { lat, lon }, limit = 8) {
  const R = 6371;
  const dist = (a) => {
    const dLat = (a.lat - lat) * rad;
    const dLon = (a.lon - lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(a.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  return (j?.ac ?? [])
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && a.alt_baro !== 'ground')
    .map((a) => ({
      callsign: String(a.flight || '').trim() || String(a.r || a.hex || '').toUpperCase(),
      registration: a.r || '',
      type: a.t || '',
      altitudeFt: Number.isFinite(a.alt_baro) ? Math.round(a.alt_baro / 100) * 100 : null,
      speedKt: Number.isFinite(a.gs) ? Math.round(a.gs) : null,
      distanceKm: Math.round(dist(a) * 10) / 10,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

// ------------------------------------------------------------------- wiring
export function createSources({ remote, getJson, getText, tz, weatherCfg, trainsCfg, bodsCfg, partsIn, sample }) {
  const H = 3_600_000;
  const pad = (n) => String(n).padStart(2, '0');
  const today = (now) => { const p = partsIn(now, tz); return { ...p, key: `${p.y}-${pad(p.m)}-${pad(p.d)}` }; };
  const where = () => (weatherCfg && Number.isFinite(Number(weatherCfg.latitude)) && Number.isFinite(Number(weatherCfg.longitude))
    ? { lat: Number(Number(weatherCfg.latitude).toFixed(4)), lon: Number(Number(weatherCfg.longitude).toFixed(4)), place: weatherCfg.place || '' }
    : null);
  const result = (e, build, loading = 'Loading…') => {
    if (e.data) return { ...build(e.data), stale: Boolean(e.error) };
    return { error: e.error ? `Unavailable right now (${e.error})` : loading };
  };

  // Open Trivia DB asks for at most one request every 5 seconds per IP.
  let tdbQueue = Promise.resolve();
  const tdbFetch = (url) => {
    const run = tdbQueue.then(() => getJson(url));
    tdbQueue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 5500)));
    return run;
  };

  return {
    metForecast() {
      const w = where();
      if (!w) return null;
      const windUnit = weatherCfg.windUnit === 'kmh' ? 'kmh' : 'mph';
      return remote(`metno:${w.lat},${w.lon}`, 15 * 60_000, async () =>
        parseMetForecast(await getJson(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${w.lat}&lon=${w.lon}`), { tz, windUnit }));
    },

    bankholiday(opts, now) {
      const division = BANK_HOLIDAY_DIVISIONS[opts.division] ? opts.division : 'england-and-wales';
      const e = remote('govuk:bank-holidays', 24 * H, () => getJson('https://www.gov.uk/bank-holidays.json'));
      return result(e, (j) => ({
        division,
        label: BANK_HOLIDAY_DIVISIONS[division],
        items: parseBankHolidays(j, division, today(now).key, Math.min(Math.max(Number(opts.limit) || 4, 1), 8)),
        credit: 'GOV.UK · Open Government Licence v3.0',
      }));
    },

    floods(opts) {
      const w = where();
      if (!w) return { error: 'Set your ground’s location in Settings → Widgets to check flood warnings.' };
      const dist = Math.min(Math.max(Number(opts.radius) || 15, 1), 100);
      const e = remote(`ea:floods:${w.lat},${w.lon},${dist}`, 15 * 60_000, () =>
        getJson(`https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${w.lat}&long=${w.lon}&dist=${dist}`));
      return result(e, (j) => ({ place: w.place, radius: dist, items: parseFloods(j), credit: 'Environment Agency real-time flood data · Open Government Licence v3.0' }));
    },

    carbon(opts) {
      const pc = String(opts.postcode || '').toUpperCase().replace(/\s+/g, '');
      const e = pc
        ? remote(`carbon:${pc}`, 30 * 60_000, async () => parseCarbon({ regional: await getJson(`https://api.carbonintensity.org.uk/regional/postcode/${encodeURIComponent(pc)}`) }))
        : remote('carbon:gb', 30 * 60_000, async () => parseCarbon({
          intensity: await getJson('https://api.carbonintensity.org.uk/intensity'),
          generation: await getJson('https://api.carbonintensity.org.uk/generation'),
        }));
      return result(e, (d) => ({ ...d, credit: 'Carbon Intensity API (NESO) · CC BY 4.0' }));
    },

    quakes(opts) {
      const feed = ['significant_week', '4.5_week', '4.5_day', '2.5_day'].includes(opts.feed) ? opts.feed : '4.5_week';
      const e = remote(`usgs:${feed}`, 15 * 60_000, () => getJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`));
      return result(e, (j) => ({ feed, items: parseQuakes(j, Math.min(Math.max(Number(opts.limit) || 6, 1), 10)), credit: 'U.S. Geological Survey (public domain)' }));
    },

    currency(opts) {
      const base = /^[A-Z]{3}$/.test(opts.base || '') ? opts.base : 'GBP';
      const symbols = (Array.isArray(opts.symbols) ? opts.symbols : ['EUR', 'USD']).filter((s) => /^[A-Z]{3}$/.test(s) && s !== base).slice(0, 8);
      const q = `${base}:${symbols.join(',')}`;
      const e = remote(`fx:${q}`, 6 * H, async () => {
        try {
          return parseRates(await getJson(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${symbols.join(',')}`));
        } catch {
          return parseRates(await getJson(`https://api.frankfurter.app/latest?from=${base}&to=${symbols.join(',')}`));
        }
      });
      return result(e, (d) => ({ ...d, credit: 'European Central Bank reference rates via Frankfurter' }));
    },

    /** Online quiz questions; returns null until loaded so callers can fall back to bundled packs. */
    opentdb(topic) {
      const cats = OPENTDB_CATEGORIES[topic] ?? OPENTDB_CATEGORIES.mixed;
      const entries = cats.map((cat) => remote(`opentdb:${cat}`, 6 * H, async () => {
        const j = await tdbFetch(`https://opentdb.com/api.php?amount=30&type=multiple&category=${cat}&encode=url3986`);
        return parseOpenTdb(j, (opts, i) => sample(opts, 4, `opentdb:${cat}:${i}:${opts[0]}`), topic);
      }));
      const items = entries.flatMap((e) => e.data ?? []);
      return items.length ? { items, error: null } : { items: null, error: entries.find((e) => e.error)?.error ?? null };
    },

    potd(opts, now) {
      const t = today(now);
      const e = remote(`wm:featured:${t.key}`, 6 * H, () => getJson(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${t.y}/${pad(t.m)}/${pad(t.d)}`));
      return result(e, (j) => {
        const p = parsePotd(j);
        return { ...p, credit: [p.artist, p.license, 'Wikimedia Commons'].filter(Boolean).join(' · ') };
      });
    },

    births(opts, now) {
      const t = today(now);
      const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 10);
      const e = remote(`wm:births:${pad(t.m)}-${pad(t.d)}`, 12 * H, () => getJson(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/births/${pad(t.m)}/${pad(t.d)}`));
      return result(e, (j) => {
        const list = parseBirths(j);
        const picked = sample(list, limit, `births:${t.key}`).sort((a, b) => a.year - b.year);
        return { month: t.m, day: t.d, label: `Born on this day — ${t.d} ${new Date(Date.UTC(2000, t.m - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`, items: picked, credit: 'Wikipedia · CC BY-SA 4.0' };
      });
    },

    sky(opts, now) {
      const w = where();
      if (!w) return { error: 'Set your ground’s location in Settings → Widgets to show sunrise and sunset.' };
      const t = today(now);
      const { sunrise, sunset } = sunTimes(t.y, t.m, t.d, w.lat, w.lon);
      const fmt = (d) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d) : null);
      const len = sunrise && sunset ? Math.round((sunset - sunrise) / 60_000) : null;
      return {
        place: w.place,
        sunrise: fmt(sunrise),
        sunset: fmt(sunset),
        dayLength: len === null ? null : `${Math.floor(len / 60)}h ${String(len % 60).padStart(2, '0')}m`,
        moon: moonPhase(now),
      };
    },

    headlines(opts) {
      const url = String(opts.url || '');
      if (!/^https?:\/\//i.test(url)) return { error: 'Add a feed address (RSS or Atom).' };
      const limit = Math.min(Math.max(Number(opts.limit) || 6, 1), 10);
      const e = remote(`rss:${url}`, 15 * 60_000, async () => parseFeed(await getText(url)));
      return result(e, (f) => ({ title: f.title, items: f.items.slice(0, limit), credit: new URL(url).hostname.replace(/^www\./, '') }));
    },

    /**
     * Transport hub: any of tube/rail line status, train departures, bus arrivals,
     * London road status and aircraft overhead, in one slide.
     */
    transport(opts) {
      const want = new Set(Array.isArray(opts.sections) && opts.sections.length ? opts.sections : ['lines']);
      const out = { sections: [], credits: new Set() };
      const add = (key, title, e, build) => {
        if (e && e.data) out.sections.push({ key, title, ...build(e.data), stale: Boolean(e.error) });
        else out.sections.push({ key, title, error: e?.error ? `Unavailable (${e.error})` : 'Loading…' });
      };

      if (want.has('lines')) {
        const modes = (Array.isArray(opts.modes) && opts.modes.length ? opts.modes : ['tube', 'elizabeth-line', 'overground', 'dlr']).filter((m) => ['tube', 'overground', 'dlr', 'elizabeth-line'].includes(m));
        add('lines', 'Line status', remote(`tfl:${modes.join(',')}`, 5 * 60_000, async () => parseTfl(await getJson(`https://api.tfl.gov.uk/Line/Mode/${modes.join(',')}/Status`))), (lines) => ({ lines }));
        out.credits.add('Powered by TfL Open Data');
      }
      if (want.has('trains')) {
        const crs = String(opts.station || '').toUpperCase();
        if (!/^[A-Z]{3}$/.test(crs)) out.sections.push({ key: 'trains', title: 'Trains', error: 'Choose a station (3-letter code, e.g. LDS).' });
        else {
          const base = String(trainsCfg?.url || 'https://huxley2.azurewebsites.net').replace(/\/+$/, '');
          const token = trainsCfg?.token ? `?accessToken=${encodeURIComponent(trainsCfg.token)}` : '';
          add('trains', 'Departures', remote(`rail:${base}:${crs}`, 60_000, async () => parseHuxley(await getJson(`${base}/departures/${crs}/10${token}`))), (b) => ({ ...b, title: b.station ? `Departures — ${b.station}` : 'Departures' }));
          out.credits.add('National Rail Enquiries (Darwin)');
        }
      }
      if (want.has('buses')) {
        const stop = String(opts.busStop || '');
        if (!/^[A-Za-z0-9]{4,20}$/.test(stop)) out.sections.push({ key: 'buses', title: 'Buses', error: 'Add a TfL stop ID (e.g. 490008660N).' });
        else {
          add('buses', 'Buses', remote(`tfl:arrivals:${stop}`, 45_000, async () => parseArrivals(await getJson(`https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(stop)}/Arrivals`))), (b) => ({ ...b, customTitle: opts.busStopName || '', title: opts.busStopName || (b.stop ? `Buses — ${b.stop}` : 'Buses') }));
          out.credits.add('Powered by TfL Open Data');
        }
      }
      if (want.has('tracker')) {
        const w = where();
        const lines = (Array.isArray(opts.trackLines) ? opts.trackLines : []).filter((l) => /^[A-Za-z0-9]{1,8}$/.test(l)).slice(0, 6);
        if (!bodsCfg?.apiKey) out.sections.push({ key: 'tracker', title: 'Bus tracker', error: 'Add a free Bus Open Data Service API key in Settings → Widgets.' });
        else if (!w) out.sections.push({ key: 'tracker', title: 'Bus tracker', error: 'Set your ground’s location in Settings → Widgets.' });
        else if (!lines.length) out.sections.push({ key: 'tracker', title: 'Bus tracker', error: 'Add the route numbers to track.' });
        else {
          const km = Math.min(Math.max(Number(opts.trackRadius) || 20, 2), 60);
          const dLat = km / 111;
          const dLon = km / (111 * Math.cos(w.lat * rad));
          const box = [w.lon - dLon, w.lat - dLat, w.lon + dLon, w.lat + dLat].map((n) => n.toFixed(4)).join(',');
          const op = /^[A-Za-z0-9]{2,8}$/.test(opts.trackOperator || '') ? `&operatorRef=${opts.trackOperator}` : '';
          const entries = lines.map((line) => remote(`bods:${box}:${line}:${op}`, 30_000, async () =>
            getText(`https://data.bus-data.dft.gov.uk/api/v1/datafeed/?boundingBox=${box}&lineRef=${encodeURIComponent(line)}${op}&api_key=${encodeURIComponent(bodsCfg.apiKey)}`)));
          const loaded = entries.filter((e) => e.data);
          if (!loaded.length) out.sections.push({ key: 'tracker', title: 'Bus tracker', error: entries.find((e) => e.error) ? `Unavailable (${entries.find((e) => e.error).error})` : 'Loading…' });
          else {
            const buses = loaded.flatMap((e) => parseSiriVm(e.data, { lat: w.lat, lon: w.lon, lines })).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 8);
            out.sections.push({ key: 'tracker', title: opts.trackTitle || `Live buses — route${lines.length > 1 ? 's' : ''} ${lines.join(', ')}`, customTitle: opts.trackTitle || '', routes: lines, buses, radiusKm: km, place: w.place, stale: entries.some((e) => e.error) });
          }
          out.credits.add('Bus Open Data Service (DfT) · Open Government Licence v3.0');
        }
      }
      if (want.has('roads')) {
        add('roads', 'London roads', remote('tfl:roads', 5 * 60_000, async () => parseRoads(await getJson('https://api.tfl.gov.uk/Road'))), (roads) => ({ roads: roads.slice(0, 12) }));
        out.credits.add('Powered by TfL Open Data');
      }
      if (want.has('planes')) {
        const w = where();
        if (!w) out.sections.push({ key: 'planes', title: 'Overhead', error: 'Set your ground’s location in Settings → Widgets.' });
        else {
          const km = Math.min(Math.max(Number(opts.planesRadius) || 15, 2), 100);
          const nm = Math.ceil(km / 1.852);
          add('planes', 'Planes overhead', remote(`adsb:${w.lat},${w.lon},${nm}`, 60_000, async () => parseAircraft(await getJson(`https://api.adsb.lol/v2/point/${w.lat}/${w.lon}/${nm}`), w)), (aircraft) => ({ aircraft: aircraft.filter((a) => a.distanceKm <= km), radiusKm: km }));
          out.credits.add('adsb.lol · ODbL');
        }
      }
      const order = ['tracker', 'trains', 'buses', 'lines', 'roads', 'planes'];
      out.sections.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      return { sections: out.sections, credit: [...out.credits].join(' · ') };
    },

    events(opts, now) {
      const url = String(opts.url || '').replace(/^webcal:\/\//i, 'https://');
      if (!/^https?:\/\//i.test(url)) return { error: 'Add a calendar address (iCal / .ics).' };
      const limit = Math.min(Math.max(Number(opts.limit) || 6, 1), 10);
      const days = Math.min(Math.max(Number(opts.days) || 60, 1), 365);
      const e = remote(`ics:${url}`, 30 * 60_000, async () => {
        const cal = parseIcs(await getText(url), { tz });
        return { title: cal.title, events: cal.events.map((ev) => ({ ...ev, start: ev.start.toISOString() })) };
      });
      return result(e, (cal) => {
        const from = now.getTime() - 3 * H;
        const to = now.getTime() + days * 86_400_000;
        const items = cal.events
          .filter((ev) => { const t = Date.parse(ev.start); return t >= (ev.allDay ? now.getTime() - 86_400_000 : from) && t <= to; })
          .sort((a, b) => a.start.localeCompare(b.start))
          .slice(0, limit)
          .map(({ title, location, start, allDay }) => ({ title, location: location || '', start, allDay: Boolean(allDay) }));
        return { title: cal.title, items, credit: new URL(url).hostname.replace(/^www\./, '') };
      });
    },
  };
}
