import axios from 'axios';
import fs from 'fs';
import { parse } from 'node-html-parser';



export async function fetchMessages(baseURL, sessionCodes) {
  const postData = new URLSearchParams({ ...sessionCodes });
  const url = baseURL + 'sfhome01.w';

  const response = await axios.post(url, postData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (response.data.includes('Your session has expired')) {
    throw new Error('Session expired');
  }

  return response.data;
}

export function parseMessages(html) {
  const root = parse(html);

  const messageFeed = root.querySelector('#MessageFeed');
  if (!messageFeed) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = './debug_logs';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(`${dir}/missing_output_${timestamp}.html`, html);
    console.warn('Warning: Could not find #MessageFeed or <output> in HTML. Dumped HTML to debug_logs.');
    return [];
  }

  const contentMap = new Map();
  const globalRegex = /\$\(.*?<div class=\\?'msgDetail\\?'[^>]*>([\s\S]*?)<\/div>\s*<\/var>'\)\.appendTo\('#(messageText_[^']+)'\);/g;
  const manualScan = [...html.matchAll(/appendTo\('#(messageText_[^']+)'\)/g)].map(m => m[1]);
  // console.log('Manual scan found spanIds being appended to:', manualScan);
  for (const match of html.matchAll(globalRegex)) {
    const startIndex = match.index || 0;
    // console.log('Full match:', match[0].slice(0, 80), '...'); // log first 80 chars
    // console.log('Captured content length:', match[1].length, 'Captured spanId:', match[2], 'Start index:', startIndex);
    const splitContent = match[1].split("').appendTo(")[0];
    const rawHtml = `<div class='msgDetail'>${splitContent}</div></div></div>`;
    const spanId = match[2];
    const parsed = parse(rawHtml);
    const cleaned = parsed.text.trim();
    if (!contentMap.has(spanId)) contentMap.set(spanId, []);
    contentMap.get(spanId).push({ content: cleaned, index: startIndex });
  }

  // console.log('All captured span IDs in contentMap:', Array.from(contentMap.keys()));

  const messages = [];

  messageFeed.querySelectorAll('li.feedItem.allowRemove').forEach(li => {
    const msgWrap = li.querySelector('.messageWrap');
    if (!msgWrap) return;

    const fromLink = msgWrap.querySelector('.messageHead > .text > a[data-type="teacher"]');
    const from = fromLink ? fromLink.text.trim() : '';

    const classLink = msgWrap.querySelector('.messageHead > .text > a[data-type="class"]');
    let className = 'Administrator';
    if (classLink) {
      const match = classLink.text.match(/\(([^/]+)\//);
      if (match && match[1]) {
        className = match[1].trim();
      }
    }

    const dateElem = msgWrap.querySelector('.messageBody > .date');
    const date = dateElem ? dateElem.text.trim() : '';

    const subjectElem = msgWrap.querySelector('.messageBody > .text > .Subject');
    const subject = subjectElem ? subjectElem.text.trim() : '';

    const spanElem = msgWrap.querySelector('.messageBody > .text > span[id^="messageText_"]');
    let content = '';
    if (spanElem) {
      const spanId = spanElem.id;
      if (contentMap.has(spanId)) {
        content = contentMap.get(spanId)
          .sort((a, b) => a.index - b.index)
          .map(item => item.content)
          .join('\n\n');
      }
    }

    messages.push({
      className,
      subject,
      from,
      date,
      content,
    });
  });

  const messageWraps = Array.from(messageFeed.querySelectorAll('.messageWrap'));

  messages.sort((a, b) => {
    const indexA = messageWraps.findIndex(el => el.getAttribute('data-id') === a.dataId);
    const indexB = messageWraps.findIndex(el => el.getAttribute('data-id') === b.dataId);
    return indexA - indexB;
  });

  return messages;
}