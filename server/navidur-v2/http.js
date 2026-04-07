'use strict';

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const timeoutMs = options && options.timeoutMs ? options.timeoutMs : 8000;
  const retries = options && typeof options.retries === 'number' ? options.retries : 2;
  const method = options && options.method ? options.method : 'GET';
  const headers = options && options.headers ? options.headers : {};

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error('HTTP_' + response.status);
      }
      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await delay(250 * (attempt + 1));
      }
    }
  }
  throw lastError || new Error('FETCH_FAILED');
}

module.exports = {
  fetchJson
};
