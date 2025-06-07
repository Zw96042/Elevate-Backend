import axios from 'axios';
import fs from 'fs';
import { parse } from 'node-html-parser';

export async function fetchAllMessages(baseURL, sessionCodes) {
  console.log("Fetch message request")
  let allMessagesHtml = '';
  let lastMessageId = null;
  let keepLoading = true;
  let count = 0;

  // Initial fetch
  const initialPostData = new URLSearchParams({ ...sessionCodes });
  const initialUrl = baseURL + 'sfhome01.w';
  const initialResponse = await axios.post(initialUrl, initialPostData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (initialResponse.data.includes('Your session has expired')) {
    throw new Error('Session expired');
  }

  allMessagesHtml += initialResponse.data;
  lastMessageId = extractLastMessageId(initialResponse.data);

  while (keepLoading && lastMessageId && count < 4) {
    const postData = new URLSearchParams({
      action: 'moreMessages',
      lastMessageRowId: lastMessageId,
      ishttp: 'true',
      sessionid: sessionCodes.sessionid,
      encses: sessionCodes.encses,
      dwd: sessionCodes.dwd,
      wfaacl: sessionCodes.wfaacl,
      'javascript.filesAdded': 'jquery.1.8.2.js,qsfmain001.css,sfhome001.css,qsfmain001.min.js,sfhome001.js',
      requestId: Date.now().toString(),
    });

    const url = `${baseURL}httploader.p?file=sfhome01.w`;

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://skyward-eisdprod.iscorp.com',
      'Referer': `${baseURL}sfhome01.w`,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (compatible; BetterSkywardClient/1.0)',
    };

    const resp = await axios.post(url, postData.toString(), { headers });

    // console.log(`Load more messages response length: ${resp.data.length}`);
    // console.log(`Response snippet: ${resp.data.slice(0, 300).replace(/\n/g, ' ')}`);

    if (!resp.data || resp.data.trim().length === 0) {
      keepLoading = false;
    } else {
      allMessagesHtml += resp.data;
      const newLastId = extractLastMessageId(resp.data);
      if (!newLastId || newLastId === lastMessageId) {
        keepLoading = false;
      } else {
        lastMessageId = newLastId;
      }
    }
    count++;
    // console.log('Fetching more messages after lastMessageId:', lastMessageId);
  }

  return allMessagesHtml;
}


function extractLastMessageId(rawResponse) {
  const cdataMatch = rawResponse.match(/<output><!\[CDATA\[(.*?)\]\]><\/output>/s);
  let htmlFragment = rawResponse;
  if (cdataMatch && cdataMatch[1]) {
    htmlFragment = cdataMatch[1];
  }

  const root = parse(htmlFragment);
  const messages = root.querySelectorAll('li.feedItem.allowRemove');
  if (messages.length === 0) return null;

  const ids = messages.map(msg => {
    const wrap = msg.querySelector('.messageWrap');
    return wrap ? wrap.getAttribute('data-wall-id') : null;
  });
  // console.log('Found message data-wall-ids in batch:', ids);

  const lastMsg = messages[messages.length - 1];
  const msgWrap = lastMsg.querySelector('.messageWrap');
  return msgWrap ? msgWrap.getAttribute('data-wall-id') : null;
}

export async function fetchMessagesAfterId(baseURL, sessionCodes, startingId, limit = 10) {
  const allHtml = [];
  let lastMessageId = startingId;
  let totalLoaded = 0;
  let keepLoading = true;

  while (keepLoading && lastMessageId && totalLoaded < limit) {
    const postData = new URLSearchParams({
      action: 'moreMessages',
      lastMessageRowId: lastMessageId,
      ishttp: 'true',
      sessionid: sessionCodes.sessionid,
      encses: sessionCodes.encses,
      dwd: sessionCodes.dwd,
      wfaacl: sessionCodes.wfaacl,
      'javascript.filesAdded': 'jquery.1.8.2.js,qsfmain001.css,sfhome001.css,qsfmain001.min.js,sfhome001.js',
      requestId: Date.now().toString(),
    });

    const url = `${baseURL}httploader.p?file=sfhome01.w`;
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://skyward-eisdprod.iscorp.com',
      'Referer': `${baseURL}sfhome01.w`,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (compatible; BetterSkywardClient/1.0)',
    };

    const resp = await axios.post(url, postData.toString(), { headers });
    if (!resp.data || resp.data.trim().length === 0) break;
    // console.log(resp.data);
    if (resp.data.includes("logout")) {
      throw new Error("Session Expired");
    }

    allHtml.push(resp.data);

    // Extract next ID
    const newLastId = extractLastMessageId(resp.data);
    if (!newLastId || newLastId === lastMessageId) break;

    lastMessageId = newLastId;
    totalLoaded += parseMessages(resp.data).length;
  }

  const combinedHtml = allHtml.join('');
  return parseMessages(combinedHtml);
}

export function parseMessages(html) {
  const root = parse(html);

  // Map to hold content pieces keyed by spanId
  const contentMap = new Map();

  // Regex to capture all appended message content blocks with their spanId
  // Capture group 1: inner HTML content of .msgDetail
  // Capture group 2: spanId appended to
  const globalRegex = /\$\('<var>(?:<div class=\\?'msgDetail\\?'[^>]*>)?([\s\S]*?)(?:<\/div><\/div>)?<\/var>'\)\.appendTo\('#(messageText_[^']+)'\);/g;

  for (const match of html.matchAll(globalRegex)) {
    const fullHtml = match[1];
    const spanId = match[2];

    // Parse and extract text content
    const parsed = parse(`<div class='msgDetail'>${fullHtml}</div>`);
    const cleaned = parsed.querySelector('.msgDetail').innerText.trim();

    if (!contentMap.has(spanId)) contentMap.set(spanId, []);
    contentMap.get(spanId).push({ content: cleaned, index: match.index });
  }

  // Log counts of content parts per spanId for debugging
  // for (const [spanId, contentParts] of contentMap.entries()) {
  //   // console.log(`spanId ${spanId} has ${contentParts.length} content part(s)`);
  // }

  const messages = [];

  // Instead of looping by messageFeeds, directly select all message list items to get all messages
  const allMessageItems = root.querySelectorAll('li.feedItem.allowRemove');
  allMessageItems.forEach(li => {
    const msgWrap = li.querySelector('.messageWrap');
    if (!msgWrap) return;

    const rawClassAttr = msgWrap.getAttribute('class') || '';

    // Extract class name or fallback to Administrator
    const classLink = msgWrap.querySelector('.messageHead > .text > a[data-type="class"]');
    let className = 'Administrator';
    if (classLink) {
      const matchClass = classLink.text.match(/\(([^/]+)\//);
      if (matchClass && matchClass[1]) {
        className = matchClass[1].trim();
      }
    } else if (rawClassAttr.includes('message_general')) {
      className = 'Administrator';
    }

    const fromLink = msgWrap.querySelector('.messageHead > .text > a[data-type="teacher"]');
    const from = fromLink ? fromLink.text.trim() : (className === 'Administrator' ? 'Administrator' : '');

    // Extract date string
    const dateElem = msgWrap.querySelector('.messageBody > .date');
    const date = dateElem ? dateElem.text.trim() : '';

    // Extract subject
    const subjectElem = msgWrap.querySelector('.messageBody > .text > .Subject');
    let subject = subjectElem ? subjectElem.text.trim() : '';

    // For Administrator messages, use fallback if no explicit subject found
    if (!subject) {
      if (className === 'Administrator') {
        subject = 'Administrator Message';
      } else {
        // As a fallback, try to use any inner text that seems like a header
        const fallbackHeader = msgWrap.querySelector('.messageBody > .text > .NoHeader');
        if (fallbackHeader) {
          subject = fallbackHeader.text.trim();
        }
      }
    }

    // Extract spanId and map content
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

    const messageRowId = msgWrap.getAttribute('data-wall-id');

    messages.push({ className, messageRowId, subject, from, date, content });
  });

  // console.log(`Parsed ${messages.length} messages.`);
  return messages;
}
