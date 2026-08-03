// GenAI Finance course, starter scaffold.
// This file intentionally does very little. Build on it during class.
//
// No API keys are stored in this file. Both the Twelve Data key and the
// OpenRouter key are entered in the form fields at run time, so nothing secret
// is ever committed to your public repo or shipped in the source.

const form = document.getElementById('ticker-form');
const results = document.getElementById('results');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const ticker = document.getElementById('ticker').value.trim().toUpperCase();
  const twelveDataKey = document.getElementById('twelvedata-key').value.trim();
  const openRouterKey = document.getElementById('openrouter-key').value.trim();

  results.innerHTML = '<p>Loading...</p>';

  try {
    const priceData = await fetchPriceData(ticker, twelveDataKey);
    const rsiData = calculateRSI(priceData);
    const macdData = calculateMACD(priceData);
    const note = await getResearchNote(ticker, priceData, rsiData, macdData, openRouterKey);
    renderResults(ticker, priceData, rsiData, macdData, note);
  } catch (err) {
    results.innerHTML = `<p class="error">Something went wrong: ${err.message}</p>`;
  }
});

// Twelve Data daily price history.
// This endpoint sends CORS headers, so it works directly from the browser.
// The free plan covers all US equities and ETFs (no ticker whitelist).
// Returns an array of daily bars sorted oldest to newest, each shaped as
// { date, open, high, low, close, volume } with numeric values.
// Replace or extend with moving average, MACD, RSI calculations from Day 1.
async function fetchPriceData(ticker, apiKey) {
  // outputsize is the number of most-recent bars. ~63 trading days is about
  // 3 months; 90 leaves a little headroom. Max allowed is 5000.
  const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=90&apikey=${apiKey}`;
  const response = await fetch(url);

  // Read the body as text first, then parse it safely, so an unexpected
  // non-JSON response gives a readable error instead of "Unexpected token".
  const body = await response.text();
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error(body.trim() || 'Price fetch failed');
  }

  // Twelve Data reports problems as { code, status: "error", message }.
  if (raw && raw.status === 'error') throw new Error(raw.message || 'Price fetch failed');
  if (!response.ok) throw new Error('Price fetch failed');

  // Successful responses look like { meta, values: [ { datetime, open, ... } ] },
  // newest first. Normalize to numbers and sort oldest to newest so indicator
  // math (moving averages, RSI, ...) reads left to right.
  const values = raw.values ?? [];
  if (!values.length) throw new Error(`No price data returned for ${ticker}`);

  return values
    .map((b) => ({
      date: b.datetime,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume)
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// --- Technical Indicators: MACD & RSI ---

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  const ema = new Array(prices.length).fill(null);
  if (prices.length < period) return ema;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let prevEma = sum / period;
  ema[period - 1] = prevEma;

  for (let i = period; i < prices.length; i++) {
    const currentEma = prices[i] * k + prevEma * (1 - k);
    ema[i] = currentEma;
    prevEma = currentEma;
  }
  return ema;
}

/**
 * Relative Strength Index (RSI - 14 Period Wilder's Smoothing)
 */
function calculateRSI(priceData, period = 14) {
  const prices = priceData.map((d) => d.close);
  const rsi = new Array(prices.length).fill(null);

  if (prices.length <= period) {
    return { values: rsi, latest: null, signal: 'N/A' };
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      rs = avgGain / avgLoss;
      rsi[i] = 100 - 100 / (1 + rs);
    }
  }

  const latestVal = rsi[rsi.length - 1];
  let signal = 'Neutral';
  if (latestVal !== null) {
    if (latestVal >= 70) signal = 'Overbought';
    else if (latestVal <= 30) signal = 'Oversold';
  }

  return {
    values: rsi,
    latest: latestVal,
    signal
  };
}

/**
 * Moving Average Convergence Divergence (MACD 12, 26, 9)
 */
function calculateMACD(priceData, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const prices = priceData.map((d) => d.close);
  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);

  const macdLine = new Array(prices.length).fill(null);
  for (let i = 0; i < prices.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }

  const validIndices = [];
  const validMacd = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      validIndices.push(i);
      validMacd.push(macdLine[i]);
    }
  }

  const signalEma = calculateEMA(validMacd, signalPeriod);
  const signalLine = new Array(prices.length).fill(null);
  const histogram = new Array(prices.length).fill(null);

  for (let k = 0; k < validIndices.length; k++) {
    const origIdx = validIndices[k];
    if (signalEma[k] !== null) {
      signalLine[origIdx] = signalEma[k];
      histogram[origIdx] = macdLine[origIdx] - signalEma[k];
    }
  }

  const latestMacd = macdLine[macdLine.length - 1];
  const latestSignal = signalLine[signalLine.length - 1];
  const latestHist = histogram[histogram.length - 1];

  let signal = 'Neutral';
  if (latestHist !== null) {
    if (latestHist > 0) signal = 'Bullish';
    else if (latestHist < 0) signal = 'Bearish';
  }

  return {
    macdLine,
    signalLine,
    histogram,
    latest: {
      macd: latestMacd,
      signal: latestSignal,
      histogram: latestHist
    },
    signal
  };
}

// OpenRouter call. The price data and technical indicators are summarized and handed to the model.
async function getResearchNote(ticker, priceData, rsiData, macdData, apiKey) {
  const first = priceData[0];
  const latest = priceData[priceData.length - 1];
  const pctChange = ((latest.close - first.close) / first.close) * 100;

  const rsiSummary = rsiData.latest !== null
    ? `RSI (14): ${rsiData.latest.toFixed(2)} (${rsiData.signal})`
    : 'RSI: N/A';

  const macdSummary = macdData.latest.macd !== null
    ? `MACD (12, 26, 9): Line ${macdData.latest.macd.toFixed(2)}, Signal ${macdData.latest.signal.toFixed(2)}, Histogram ${macdData.latest.histogram.toFixed(2)} (${macdData.signal})`
    : 'MACD: N/A';

  const summary =
    `${ticker} daily closes from ${first.date} to ${latest.date}: ` +
    `start $${first.close.toFixed(2)}, latest $${latest.close.toFixed(2)}, ` +
    `change ${pctChange.toFixed(1)}% over ${priceData.length} trading days.\n` +
    `Technical Indicators -> ${rsiSummary} | ${macdSummary}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 2000,
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: 'You are a financial research assistant. Be concise and factual.' },
        { role: 'user', content: `${summary}\n\nWrite a concise one paragraph research note for ${ticker} incorporating recent price action, RSI, and MACD momentum signals.` }
      ]
    })
  });

  if (!response.ok) throw new Error(`OpenRouter call failed. ${await readOpenRouterError(response)}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? 'No response.';
}

// Pulls the useful part out of an OpenRouter error response: the HTTP status,
// a plain-language hint for the common cases, and the message OpenRouter (or
// the upstream provider) actually returned.
async function readOpenRouterError(response) {
  let message = '';
  try {
    const body = await response.json();
    const err = body.error ?? body;
    message = err.message || '';
    const provider = err.metadata?.provider_name;
    const raw = err.metadata?.raw;
    if (provider) message += ` [provider: ${provider}]`;
    if (raw) message += ` ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`;
  } catch {
    // Response body was not JSON; the status code below still says something.
  }
  const hint = {
    401: 'Your API key looks invalid or missing',
    402: 'This model is paid and your OpenRouter account is out of credits',
    429: 'Rate limited, wait a moment and try again'
  }[response.status];
  return [`(HTTP ${response.status})`, hint, message].filter(Boolean).join(' ');
}

function renderResults(ticker, priceData, rsiData, macdData, note) {
  const latest = priceData[priceData.length - 1];
  const first = priceData[0];
  const pctChange = ((latest.close - first.close) / first.close) * 100;
  const isPositive = pctChange >= 0;

  const rsiVal = rsiData.latest !== null ? rsiData.latest.toFixed(2) : 'N/A';
  const macdVal = macdData.latest.macd !== null ? macdData.latest.macd.toFixed(2) : 'N/A';
  const signalVal = macdData.latest.signal !== null ? macdData.latest.signal.toFixed(2) : 'N/A';
  const histVal = macdData.latest.histogram !== null ? macdData.latest.histogram.toFixed(2) : 'N/A';

  results.innerHTML = `
    <div class="results-header">
      <h2>${ticker}</h2>
      <div class="price-block">
        <span class="price-value">$${latest.close.toFixed(2)}</span>
        <span class="price-change ${isPositive ? 'positive' : 'negative'}">
          ${isPositive ? '+' : ''}${pctChange.toFixed(2)}%
        </span>
      </div>
      <p class="date-range">${first.date} to ${latest.date}</p>
    </div>

    <div class="indicators-grid">
      <div class="indicator-card">
        <div class="indicator-title">
          <span>RSI (14)</span>
          <span class="badge ${rsiData.signal.toLowerCase()}">${rsiData.signal}</span>
        </div>
        <div class="indicator-value">${rsiVal}</div>
        <div class="indicator-desc">
          ${rsiData.signal === 'Overbought' ? 'Overbought (>70)' : rsiData.signal === 'Oversold' ? 'Oversold (<30)' : 'Neutral zone (30-70)'}
        </div>
      </div>

      <div class="indicator-card">
        <div class="indicator-title">
          <span>MACD (12, 26, 9)</span>
          <span class="badge ${macdData.signal.toLowerCase()}">${macdData.signal}</span>
        </div>
        <div class="indicator-value">${macdVal}</div>
        <div class="indicator-details">
          <span>Signal: <strong>${signalVal}</strong></span>
          <span>Hist: <strong>${histVal}</strong></span>
        </div>
      </div>
    </div>

    <div class="note-section">
      <h3>AI Analysis & Research Note</h3>
      <p class="note-text">${note}</p>
    </div>
  `;
}
