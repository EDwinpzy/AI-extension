/*
 * Rendered-page inspector for bookmark classification.
 *
 * A service-worker fetch only sees the HTML a server sends. It misses content
 * rendered by JavaScript, and often stops at a cookie or login shell. Open a
 * background tab instead, let the real document settle, then ask it for the
 * title, metadata and main text that the user can actually see.
 *
 * Plain script, not a module: background-loader.js imports it before the
 * classifier.
 */

(function () {
  'use strict';

  const TAB_LOAD_TIMEOUT_MS = 25000;
  const RENDER_SETTLE_MS = 5000;
  const INSPECT_CONCURRENCY = 2;

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function cacheKey(value) {
    try {
      const url = new URL(value);
      url.hash = '';
      return url.toString();
    } catch (error) {
      return String(value || '');
    }
  }

  /*
   * This function is serialized into the page by chrome.scripting.executeScript,
   * so it must not reference anything outside its own body.
   */
  async function collectRenderedPage(config) {
    const normalize = (value) => String(value || '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const clip = (value, limit) => normalize(value).slice(0, limit);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const meta = (selectors) => {
      for (const selector of selectors) {
        const text = normalize(document.querySelector(selector)?.getAttribute('content'));
        if (text) return text;
      }
      return '';
    };
    const visible = (node) => {
      if (!node || !(node instanceof Element)) return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const visibleText = (node) => visible(node) ? normalize(node.innerText || node.textContent) : '';

    const cleanText = (node) => {
      if (!node) return '';
      const clone = node.cloneNode(true);
      clone.querySelectorAll([
        'script', 'style', 'noscript', 'template', 'svg', 'canvas',
        'nav', 'footer', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '[aria-hidden="true"]',
      ].join(',')).forEach((noise) => noise.remove());
      return normalize(clone.innerText || clone.textContent);
    };

    const candidates = [
      ['article', 5000],
      ['main', 4500],
      ['[role="main"]', 4200],
      ['.article-content', 4000],
      ['.post-content', 3900],
      ['.entry-content', 3800],
      ['.rich_media_content', 3700],
      ['.markdown-body', 3600],
      ['#content', 2600],
      ['.content', 2500],
    ];
    const findBestText = () => {
      const ranked = [];
      for (const [selector, bonus] of candidates) {
        for (const node of Array.from(document.querySelectorAll(selector)).slice(0, 8)) {
          const text = cleanText(node);
          if (text.length < 40) continue;
          ranked.push({
            text,
            score: Math.min(text.length, 5000) + bonus + (node.querySelector('h1') ? 250 : 0),
          });
        }
      }
      if (document.body) {
        const text = cleanText(document.body);
        if (text) ranked.push({ text, score: Math.min(text.length, 5000) });
      }
      ranked.sort((a, b) => b.score - a.score);
      return ranked[0] ? ranked[0].text : '';
    };

    const read = () => {
      const title = clip(
        meta(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
        document.title ||
        visibleText(document.querySelector('h1')),
        config.titleLimit
      );
      const description = clip(
        meta([
          'meta[name="description"]',
          'meta[property="og:description"]',
          'meta[name="twitter:description"]',
        ]),
        config.descriptionLimit
      );
      const keywords = clip(meta(['meta[name="keywords"]', 'meta[property="article:tag"]']), 300);
      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .filter(visible)
        .map(visibleText)
        .filter((text, index, all) => text.length >= 2 && all.indexOf(text) === index)
        .slice(0, config.headingLimit);
      const best = findBestText();
      const snippet = clip([headings.slice(0, 4).join(' · '), best].filter(Boolean).join('\n'), config.snippetLimit);
      return {
        title,
        description,
        keywords,
        headings,
        snippet,
        textLength: best.length,
        readyState: document.readyState,
        finalUrl: location.href,
      };
    };

    const started = Date.now();
    let best = read();
    let stable = 0;
    let previousSignature = '';
    while (Date.now() - started < config.settleMs) {
      const current = read();
      if (current.snippet.length >= best.snippet.length) best = current;
      const enough = current.snippet.length >= config.minSnippetLength;
      const signature = current.title + '\n' + current.description + '\n' + current.snippet;
      if (enough && signature === previousSignature) stable++;
      else stable = 0;
      previousSignature = signature;
      if ((enough && stable >= 2 && Date.now() - started >= 800) ||
          (current.snippet.length >= 900 && current.description && Date.now() - started >= 1200)) {
        break;
      }
      await sleep(250);
    }
    const latest = read();
    return latest.snippet.length > best.snippet.length ? latest : best;
  }

  function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (error) {}
        try { chrome.tabs.onRemoved.removeListener(onRemoved); } catch (error) {}
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo && changeInfo.status === 'complete') finish();
      };
      const onRemoved = (removedTabId) => {
        if (removedTabId === tabId) finish(new Error('标签页在读取完成前已关闭'));
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
      timer = setTimeout(() => finish(new Error('网页加载超时')), timeoutMs);
      Promise.resolve(chrome.tabs.get(tabId))
        .then((tab) => {
          if (tab && tab.status === 'complete') finish();
        })
        .catch((error) => finish(error));
    });
  }

  async function inspectUrl(url, options) {
    if (!isHttpUrl(url)) {
      return { ok: false, error: '不是可打开的网页地址' };
    }

    const timeoutMs = Math.max(3000, Number(options && options.timeoutMs) || TAB_LOAD_TIMEOUT_MS);
    let tabId = null;
    let created = false;
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab && tab.id;
      created = Number.isInteger(tabId);
      if (!created) throw new Error('浏览器没有创建读取标签页');

      // Background pages can still autoplay audio. Mute the temporary tab as
      // soon as it exists; this does not change the user's other tabs.
      if (chrome.tabs.update) {
        chrome.tabs.update(tabId, { muted: true }).catch(() => {});
      }

      await waitForTabComplete(tabId, timeoutMs);
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: collectRenderedPage,
        args: [{
          titleLimit: 240,
          descriptionLimit: 500,
          headingLimit: 8,
          snippetLimit: 1400,
          minSnippetLength: 120,
          settleMs: Math.min(RENDER_SETTLE_MS, Math.max(1200, timeoutMs - 1000)),
        }],
      });
      const result = results && results[0] && results[0].result;
      if (!result) throw new Error('页面没有返回正文');
      const meaningful = Boolean(
        result.snippet ||
        result.description ||
        (result.title && result.title !== url)
      );
      if (!meaningful) throw new Error('页面没有可读内容');
      return { ok: true, ...result };
    } catch (error) {
      const message = String((error && error.message) || error)
        .replace(/^Error:\s*/i, '')
        .slice(0, 240);
      return { ok: false, error: message || '页面读取失败' };
    } finally {
      if (created && Number.isInteger(tabId)) {
        try { await chrome.tabs.remove(tabId); } catch (error) {}
      }
    }
  }

  async function inspectBookmarks(bookmarks, options) {
    const source = Array.isArray(bookmarks) ? bookmarks : [];
    const enriched = source.map((bookmark) => ({ ...bookmark }));
    const results = new Map();
    const concurrency = Math.max(
      1,
      Math.min(4, Number(options && options.concurrency) || INSPECT_CONCURRENCY)
    );
    let cursor = 0;
    let done = 0;
    const stats = { total: enriched.length, done: 0, read: 0, partial: 0, failed: 0 };

    const publish = () => {
      stats.done = done;
      if (options && typeof options.onProgress === 'function') {
        options.onProgress({ ...stats });
      }
    };

    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= enriched.length) return;
        const bookmark = enriched[index];
        let result;
        if (!isHttpUrl(bookmark.url)) {
          result = { ok: false, error: '不是可打开的网页地址' };
        } else {
          const key = cacheKey(bookmark.url);
          if (!results.has(key)) results.set(key, inspectUrl(bookmark.url, options));
          result = await results.get(key);
        }

        bookmark.pageTitle = result && result.ok ? result.title || '' : '';
        bookmark.pageDescription = result && result.ok ? result.description || '' : '';
        bookmark.pageKeywords = result && result.ok ? result.keywords || '' : '';
        bookmark.pageHeadings = result && result.ok ? result.headings || [] : [];
        bookmark.pageSnippet = result && result.ok ? result.snippet || '' : '';
        bookmark.pageFinalUrl = result && result.ok ? result.finalUrl || bookmark.url : bookmark.url;
        const hasRoomToJudge = result && result.ok && (
          Number(result.textLength) >= 40 ||
          String(result.description || '').length >= 80
        );
        bookmark.pageReadState = hasRoomToJudge ? 'read' : (result && result.ok ? 'partial' : 'failed');
        bookmark.pageReadError = result && !result.ok ? result.error || '页面读取失败' : '';

        if (bookmark.pageReadState === 'read') stats.read++;
        else if (bookmark.pageReadState === 'partial') stats.partial++;
        else stats.failed++;
        done++;
        publish();
      }
    };

    publish();
    await Promise.all(Array.from({ length: Math.min(concurrency, enriched.length) }, () => worker()));
    return { bookmarks: enriched, stats: { ...stats, done: enriched.length } };
  }

  self.CodexBookmarkPageInspector = Object.assign(
    self.CodexBookmarkPageInspector || {},
    {
      inspectUrl,
      inspectBookmarks,
      collectRenderedPage,
    }
  );
})();
