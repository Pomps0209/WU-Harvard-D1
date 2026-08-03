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
    const recData = calculateRecommendation(priceData, rsiData, macdData);
    const note = await getResearchNote(ticker, priceData, rsiData, macdData, recData, openRouterKey);
    renderResults(ticker, priceData, rsiData, macdData, recData, note);
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
  // outputsize=252 corresponds to ~1 full trading year of daily bars.
  const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=252&apikey=${apiKey}`;
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

/**
 * Calculates a technical recommendation (BUY, SELL, or HOLD) based on RSI, MACD, and SMA trend metrics.
 */
function calculateRecommendation(priceData, rsiData, macdData) {
  let score = 0;
  const reasons = [];

  // 1. RSI Scoring
  if (rsiData.latest !== null) {
    const rsi = rsiData.latest;
    if (rsi <= 30) {
      score += 2;
      reasons.push(`RSI is oversold (${rsi.toFixed(1)} <= 30)`);
    } else if (rsi < 45) {
      score += 1;
      reasons.push(`RSI is in lower neutral zone (${rsi.toFixed(1)})`);
    } else if (rsi > 70) {
      score -= 2;
      reasons.push(`RSI is overbought (${rsi.toFixed(1)} >= 70)`);
    } else if (rsi > 55) {
      score -= 1;
      reasons.push(`RSI is in upper neutral zone (${rsi.toFixed(1)})`);
    } else {
      reasons.push(`RSI is neutral (${rsi.toFixed(1)})`);
    }
  }

  // 2. MACD Scoring
  if (macdData.latest.histogram !== null) {
    const hist = macdData.latest.histogram;
    const macdLine = macdData.latest.macd;
    const signalLine = macdData.latest.signal;

    if (hist > 0) {
      score += 1.5;
      reasons.push(`MACD histogram is positive (+${hist.toFixed(2)})`);
    } else if (hist < 0) {
      score -= 1.5;
      reasons.push(`MACD histogram is negative (${hist.toFixed(2)})`);
    }

    if (macdLine > signalLine) {
      score += 0.5;
      reasons.push('MACD line above signal line');
    } else if (macdLine < signalLine) {
      score -= 0.5;
      reasons.push('MACD line below signal line');
    }
  }

  // 3. Moving Average Trend (50-day & 200-day Simple Moving Average)
  const closes = priceData.map((d) => d.close);
  const latestClose = closes[closes.length - 1];

  if (closes.length >= 50) {
    const last50 = closes.slice(closes.length - 50);
    const sma50 = last50.reduce((sum, val) => sum + val, 0) / 50;

    if (latestClose > sma50) {
      score += 1;
      reasons.push(`Price ($${latestClose.toFixed(2)}) above 50-day SMA ($${sma50.toFixed(2)})`);
    } else {
      score -= 1;
      reasons.push(`Price ($${latestClose.toFixed(2)}) below 50-day SMA ($${sma50.toFixed(2)})`);
    }

    if (closes.length >= 200) {
      const last200 = closes.slice(closes.length - 200);
      const sma200 = last200.reduce((sum, val) => sum + val, 0) / 200;

      if (sma50 > sma200) {
        score += 1;
        reasons.push(`50-day SMA ($${sma50.toFixed(2)}) > 200-day SMA ($${sma200.toFixed(2)}) - Golden Cross trend`);
      } else {
        score -= 1;
        reasons.push(`50-day SMA ($${sma50.toFixed(2)}) < 200-day SMA ($${sma200.toFixed(2)}) - Death Cross trend`);
      }
    }
  }

  // Determine Recommendation Action
  let action = 'HOLD';
  let badgeClass = 'rec-hold';

  if (score >= 2.0) {
    action = 'BUY';
    badgeClass = 'rec-buy';
  } else if (score <= -2.0) {
    action = 'SELL';
    badgeClass = 'rec-sell';
  }

  return {
    action,
    score,
    badgeClass,
    reasons
  };
}

// OpenRouter call. The price data and technical indicators are summarized and handed to the model.
async function getResearchNote(ticker, priceData, rsiData, macdData, recData, apiKey) {
  if (!apiKey) {
    return '⚠️ OpenRouter API key is missing. Please enter your OpenRouter key (sk-or-...) in the form to generate AI research notes.';
  }

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
    `Technical Indicators -> ${rsiSummary} | ${macdSummary}\n` +
    `Technical Recommendation: ${recData.action} (Composite Score: ${recData.score > 0 ? '+' : ''}${recData.score.toFixed(1)}). Key Signals: ${recData.reasons.join('; ')}.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        max_tokens: 2000,
        messages: [
          { role: 'system', content: 'You are a financial research assistant. Be concise and factual.' },
          { role: 'user', content: `${summary}\n\nWrite a concise one paragraph research note for ${ticker} explaining the ${recData.action} technical recommendation based on the price action, RSI, MACD, and SMA moving averages.` }
        ]
      })
    });

    if (!response.ok) {
      const errDetails = await readOpenRouterError(response);
      return `⚠️ OpenRouter API Key Error: ${errDetails}. Please double-check your key (starts with sk-or-...) at openrouter.ai.`;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? 'No response received from model.';
  } catch (err) {
    return `⚠️ Could not reach OpenRouter API: ${err.message}. Technical calculations and charts are displayed above.`;
  }
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

function renderResults(ticker, priceData, rsiData, macdData, recData, note) {
  const latest = priceData[priceData.length - 1];
  const first = priceData[0];
  const pctChange = ((latest.close - first.close) / first.close) * 100;
  const isPositive = pctChange >= 0;

  const rsiVal = rsiData.latest !== null ? rsiData.latest.toFixed(2) : 'N/A';
  const macdVal = macdData.latest.macd !== null ? macdData.latest.macd.toFixed(2) : 'N/A';
  const signalVal = macdData.latest.signal !== null ? macdData.latest.signal.toFixed(2) : 'N/A';
  const histVal = macdData.latest.histogram !== null ? macdData.latest.histogram.toFixed(2) : 'N/A';

  const chartSVG = generate1YearChartSVG(ticker, priceData, rsiData, macdData);

  const reasonsList = recData.reasons.map((r) => `<li>${r}</li>`).join('');

  results.innerHTML = `
    <div class="results-header">
      <h2>${ticker}</h2>
      <div class="price-block">
        <span class="price-value">$${latest.close.toFixed(2)}</span>
        <span class="price-change ${isPositive ? 'positive' : 'negative'}">
          ${isPositive ? '+' : ''}${pctChange.toFixed(2)}% (1-Yr)
        </span>
      </div>
      <p class="date-range">${first.date} to ${latest.date} (${priceData.length} trading days)</p>
    </div>

    <!-- TECHNICAL RECOMMENDATION CARD -->
    <div class="recommendation-card ${recData.badgeClass}">
      <div class="rec-header">
        <div class="rec-title-group">
          <span class="rec-subtitle">Technical Recommendation</span>
          <span class="rec-badge">${recData.action}</span>
        </div>
        <div class="rec-score">
          Score: <strong>${recData.score > 0 ? '+' : ''}${recData.score.toFixed(1)}</strong>
        </div>
      </div>
      <div class="rec-body">
        <ul class="rec-reasons">
          ${reasonsList}
        </ul>
      </div>
    </div>

    <div class="chart-section">
      <div class="chart-header">
        <h3>1-Year Price & Technical Analysis Chart</h3>
        <div class="chart-legend">
          <span class="legend-item"><span class="legend-color price-line"></span>Price ($)</span>
          <span class="legend-item"><span class="legend-color rsi-line"></span>RSI (14)</span>
          <span class="legend-item"><span class="legend-color macd-line"></span>MACD</span>
          <span class="legend-item"><span class="legend-color signal-line"></span>Signal</span>
        </div>
      </div>
      <div class="svg-container">
        ${chartSVG}
      </div>
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

function generate1YearChartSVG(ticker, priceData, rsiData, macdData) {
  const w = 760;
  const h = 420;
  const paddingLeft = 55;
  const paddingRight = 20;
  const chartW = w - paddingLeft - paddingRight;

  // Price chart dimensions
  const priceTop = 25;
  const priceHeight = 180;

  // RSI chart dimensions
  const rsiTop = 235;
  const rsiHeight = 65;

  // MACD chart dimensions
  const macdTop = 330;
  const macdHeight = 60;

  const N = priceData.length;
  if (N < 2) return '<p>Not enough data points for chart.</p>';

  // Price Min/Max
  const closes = priceData.map((d) => d.close);
  let minP = Math.min(...closes);
  let maxP = Math.max(...closes);
  const pMargin = (maxP - minP) * 0.05 || 1;
  minP -= pMargin;
  maxP += pMargin;

  const getX = (index) => paddingLeft + (index / (N - 1)) * chartW;
  const getPriceY = (val) => priceTop + priceHeight - ((val - minP) / (maxP - minP)) * priceHeight;

  // Generate Price Path & Area
  const pricePoints = closes.map((c, i) => `${getX(i).toFixed(1)},${getPriceY(c).toFixed(1)}`);
  const pricePathD = `M ${pricePoints.join(' L ')}`;
  const areaPathD = `M ${getX(0).toFixed(1)},${priceTop + priceHeight} L ${pricePoints.join(' L ')} L ${getX(N - 1).toFixed(1)},${priceTop + priceHeight} Z`;

  const isPositive = closes[N - 1] >= closes[0];
  const mainColor = isPositive ? '#16a34a' : '#dc2626';
  const gradId = `priceGrad-${ticker}`;

  // Price Gridlines & Labels (4 steps)
  let priceGridHTML = '';
  for (let step = 0; step <= 4; step++) {
    const val = minP + (step / 4) * (maxP - minP);
    const y = getPriceY(val);
    priceGridHTML += `
      <line x1="${paddingLeft}" y1="${y}" x2="${w - paddingRight}" y2="${y}" stroke="rgba(107,33,168,0.12)" stroke-dasharray="3,3" />
      <text x="${paddingLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#3b0764" font-family="Montserrat">$${val.toFixed(2)}</text>
    `;
  }

  // Date Labels (approx 6 ticks across the year)
  let dateTicksHTML = '';
  const dateInterval = Math.floor((N - 1) / 5);
  for (let i = 0; i < N; i += dateInterval) {
    const x = getX(i);
    const dateStr = priceData[i].date;
    // Format date string MM/YY
    const dateParts = dateStr.split('-');
    const formattedDate = dateParts.length === 3 ? `${dateParts[1]}/${dateParts[0].slice(2)}` : dateStr;

    dateTicksHTML += `
      <line x1="${x}" y1="${priceTop + priceHeight}" x2="${x}" y2="${priceTop + priceHeight + 4}" stroke="#6b21a8" />
      <text x="${x}" y="${priceTop + priceHeight + 16}" text-anchor="middle" font-size="10" fill="#3b0764" font-family="Montserrat">${formattedDate}</text>
    `;
  }

  // RSI Path
  const getRsiY = (val) => rsiTop + rsiHeight - (val / 100) * rsiHeight;
  const rsiPoints = [];
  rsiData.values.forEach((v, i) => {
    if (v !== null) {
      rsiPoints.push(`${getX(i).toFixed(1)},${getRsiY(v).toFixed(1)}`);
    }
  });
  const rsiPathD = rsiPoints.length > 0 ? `M ${rsiPoints.join(' L ')}` : '';

  // MACD Paths
  const macdVals = macdData.macdLine.filter((v) => v !== null);
  const signalVals = macdData.signalLine.filter((v) => v !== null);
  const histVals = macdData.histogram.filter((v) => v !== null);

  let maxMacdAbs = 1;
  if (macdVals.length > 0) {
    const allM = [...macdVals, ...signalVals, ...histVals].map(Math.abs);
    maxMacdAbs = Math.max(...allM) * 1.1 || 1;
  }

  const getMacdY = (val) => macdTop + macdHeight / 2 - (val / maxMacdAbs) * (macdHeight / 2);

  const macdPoints = [];
  const signalPoints = [];
  let histBarsHTML = '';
  const barWidth = Math.max(1, chartW / N - 0.5);

  for (let i = 0; i < N; i++) {
    const x = getX(i);
    if (macdData.macdLine[i] !== null) {
      macdPoints.push(`${x.toFixed(1)},${getMacdY(macdData.macdLine[i]).toFixed(1)}`);
    }
    if (macdData.signalLine[i] !== null) {
      signalPoints.push(`${x.toFixed(1)},${getMacdY(macdData.signalLine[i]).toFixed(1)}`);
    }
    if (macdData.histogram[i] !== null) {
      const hVal = macdData.histogram[i];
      const yZero = getMacdY(0);
      const yVal = getMacdY(hVal);
      const hHeight = Math.abs(yVal - yZero);
      const hY = hVal >= 0 ? yVal : yZero;
      const barColor = hVal >= 0 ? '#16a34a' : '#dc2626';
      histBarsHTML += `<rect x="${(x - barWidth / 2).toFixed(1)}" y="${hY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, hHeight).toFixed(1)}" fill="${barColor}" opacity="0.65" />`;
    }
  }

  const macdPathD = macdPoints.length > 0 ? `M ${macdPoints.join(' L ')}` : '';
  const signalPathD = signalPoints.length > 0 ? `M ${signalPoints.join(' L ')}` : '';

  return `
    <svg viewBox="0 0 ${w} ${h}" class="analysis-chart">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${mainColor}" stop-opacity="0.35" />
          <stop offset="100%" stop-color="${mainColor}" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- PRICE CHART SECTION -->
      <g class="price-chart">
        <text x="${paddingLeft}" y="${priceTop - 8}" font-size="11" font-weight="700" fill="#3b0764" font-family="Montserrat">PRICE ACTION (1 YEAR)</text>
        ${priceGridHTML}
        ${dateTicksHTML}
        <path d="${areaPathD}" fill="url(#${gradId})" />
        <path d="${pricePathD}" fill="none" stroke="${mainColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      </g>

      <!-- RSI CHART SECTION -->
      <g class="rsi-chart">
        <text x="${paddingLeft}" y="${rsiTop - 8}" font-size="11" font-weight="700" fill="#3b0764" font-family="Montserrat">RSI (14)</text>
        
        <!-- RSI background limits -->
        <rect x="${paddingLeft}" y="${getRsiY(70)}" width="${chartW}" height="${getRsiY(30) - getRsiY(70)}" fill="rgba(107,33,168,0.04)" />
        <line x1="${paddingLeft}" y1="${getRsiY(70)}" x2="${w - paddingRight}" y2="${getRsiY(70)}" stroke="#dc2626" stroke-dasharray="2,2" stroke-width="1" />
        <line x1="${paddingLeft}" y1="${getRsiY(30)}" x2="${w - paddingRight}" y2="${getRsiY(30)}" stroke="#16a34a" stroke-dasharray="2,2" stroke-width="1" />
        <text x="${w - paddingRight + 2}" y="${getRsiY(70) + 3}" font-size="8" fill="#dc2626" font-family="Montserrat">70</text>
        <text x="${w - paddingRight + 2}" y="${getRsiY(30) + 3}" font-size="8" fill="#16a34a" font-family="Montserrat">30</text>
        
        <path d="${rsiPathD}" fill="none" stroke="#6b21a8" stroke-width="1.8" stroke-linecap="round" />
      </g>

      <!-- MACD CHART SECTION -->
      <g class="macd-chart">
        <text x="${paddingLeft}" y="${macdTop - 8}" font-size="11" font-weight="700" fill="#3b0764" font-family="Montserrat">MACD (12, 26, 9)</text>
        <line x1="${paddingLeft}" y1="${getMacdY(0)}" x2="${w - paddingRight}" y2="${getMacdY(0)}" stroke="#6b21a8" stroke-opacity="0.3" stroke-width="1" />
        ${histBarsHTML}
        <path d="${macdPathD}" fill="none" stroke="#2563eb" stroke-width="1.8" />
        <path d="${signalPathD}" fill="none" stroke="#d97706" stroke-width="1.5" stroke-dasharray="3,2" />
      </g>
    </svg>
  `;
}
