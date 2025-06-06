import fs from 'fs';
import path from 'path';
import { parse } from 'node-html-parser';

async function testParse() {
  try {
    const filePath = path.resolve('./debug_logs/full_input.html');
    const html = fs.readFileSync(filePath, 'utf8');

    const messages = parseMessages(html);

    console.log('Parsed messages output:');
    console.log(JSON.stringify(messages, null, 2));

    console.log(`Total messages parsed: ${messages.length}`);
  } catch (err) {
    console.error('Error during parsing test:', err);
  }
}

function parseMessages(html) {
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
  for (const [spanId, contentParts] of contentMap.entries()) {
    console.log(`spanId ${spanId} has ${contentParts.length} content part(s)`);
  }

  const messages = [];

  // Instead of looping by messageFeeds, directly select all message list items to get all messages
  const allMessageItems = root.querySelectorAll('li.feedItem.allowRemove');
  allMessageItems.forEach(li => {
    const msgWrap = li.querySelector('.messageWrap');
    if (!msgWrap) return;

    // Extract sender name
    const fromLink = msgWrap.querySelector('.messageHead > .text > a[data-type="teacher"]');
    const from = fromLink ? fromLink.text.trim() : '';

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

    messages.push({ className, subject, from, date, content });
  });

  console.log(`Parsed ${messages.length} messages.`);
  return messages;
}

testParse();