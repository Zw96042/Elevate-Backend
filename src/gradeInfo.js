import { JSDOM } from "jsdom";
import  fs from 'fs';

// Parser for Skyward grade info HTML/JS response
export function parseGradeInfo(html) {
  // Check for empty <data> in XML response (session expired)
  if (typeof html === 'string' && html.match(/<data><!\[CDATA\[\s*\]\]><\/data>/)) {
    const err = new Error('Session expired');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }

  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Helpers
  const clean = (txt = "") => txt.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const toInt = (txt) => {
    const m = clean(txt).match(/^-?\d+/);
    return m ? parseInt(m[0], 10) : null;
  };
  const toFloat = (txt) => {
    const m = clean(txt).match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };

  // Course, period, instructor
  const courseLink = document.querySelector("h2.gb_heading a");
  const periodText = document.querySelector("h2.gb_heading span.fXs b")?.textContent;
  const instructorLink = document.querySelectorAll("h2.gb_heading a")[1];
  const course = clean(courseLink?.textContent || "");
  const period = toInt(periodText);
  const instructor = clean(instructorLink?.textContent || "");

  // Lit info
  const litHeader = document.querySelector("table[id^='grid_stuTermSummaryGrid'] thead th");
  // Prefer the text before the <span> (e.g., "PR1 Grade"); fall back to full text
  const litHeaderText = clean(litHeader?.childNodes?.[0]?.textContent || litHeader?.textContent || "");
  const litName = litHeaderText.replace(/Grade\s*$/, "").trim();
  const dateMatch = (litHeader?.querySelector("span")?.textContent || "").match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
  const lit = {
    name: litName,
    begin: dateMatch ? dateMatch[1] : null,
    end: dateMatch ? dateMatch[2] : null,
  };

  // Summary score
  const summaryRow = document.querySelector("table[id^='grid_stuTermSummaryGrid'] tbody tr[class]:not(.sf_Section)");
  const topScore = toFloat(summaryRow?.querySelector("td:last-child")?.textContent || "");
  const topGrade = topScore != null ? Math.round(topScore) : null;

  // Gradebook (categories + assignments)
  const gradebook = [];
  const rows = [...document.querySelectorAll("table[id^='grid_stuAssignmentSummaryGrid'] tbody tr")];
  let currentCategory = null;
  let lastMainCategory = null;
  let rcWeights = [];
  let afterBoldCategory = false;

  rows.forEach((row, idx) => {
    // Debug: log row type and content
    if (row.classList.contains("sf_Section") && row.classList.contains("cat")) {
      const cells = row.querySelectorAll("td");
      const nameNode = cells[1]?.childNodes?.[0];
      const rawName = clean(nameNode?.textContent || cells[1]?.textContent || "");
      const isBold = cells[1]?.style?.fontWeight === "bold" || /font-weight:bold/i.test(cells[1]?.getAttribute("style") || "");
      // Find weight in any span in the cell
      let weightMatch = null;
      let foundWeightSpan = '';
      const spans = cells[1]?.querySelectorAll("span") || [];
      for (const span of spans) {
        const txt = clean(span.textContent || "");
        const match = txt.match(/weighted at ([\d.]+)%(?:, adjusted to ([\d.]+)%)?/i);
        if (match) {
          weightMatch = match;
          foundWeightSpan = txt;
          break;
        }
      }
      
      if (isBold) {
      
        lastMainCategory = {
          category: rawName,
          weight: null,
          adjustedWeight: null,
          assignments: [],
        };
        afterBoldCategory = true;
        // If weight is present in the bold row, use it
        if (weightMatch) {
          lastMainCategory.weight = parseFloat(weightMatch[1]);
          lastMainCategory.adjustedWeight = weightMatch[2] ? parseFloat(weightMatch[2]) : null;
        }
        gradebook.push(lastMainCategory);
        currentCategory = lastMainCategory;
        return;
      }

      // If this is RC1 or RC2 after a bold category, assign weight from RC1 to main category and do not push RC1/RC2 as categories
      if (/RC\d/i.test(rawName) && afterBoldCategory) {
        // Use the span search weightMatch for RC rows
        // Always assign RC1 weight to the last main category if not set
        if (/RC1/i.test(rawName) && weightMatch && lastMainCategory && lastMainCategory.weight == null) {
          lastMainCategory.weight = parseFloat(weightMatch[1]);
          lastMainCategory.adjustedWeight = weightMatch[2] ? parseFloat(weightMatch[2]) : null;
        }
        // If RC2 comes first, store its weight and assign after RC1
        if (/RC2/i.test(rawName) && weightMatch && lastMainCategory && lastMainCategory.weight == null) {
          lastMainCategory._pendingWeight = {
            weight: parseFloat(weightMatch[1]),
            adjustedWeight: weightMatch[2] ? parseFloat(weightMatch[2]) : null,
          };
        }
        // If RC1 comes and RC2 weight was stored, use RC1 weight, else use RC2
        if (/RC1/i.test(rawName) && lastMainCategory && lastMainCategory.weight == null && lastMainCategory._pendingWeight) {
          // Prefer RC1 weight if available, else RC2
          lastMainCategory.weight = parseFloat(weightMatch[1]);
          lastMainCategory.adjustedWeight = weightMatch[2] ? parseFloat(weightMatch[2]) : lastMainCategory._pendingWeight.adjustedWeight;
          delete lastMainCategory._pendingWeight;
        }
        // Do NOT push RC1/RC2 as categories
        return;
      }

      // If not bold and not RC1/RC2, treat as normal category
      currentCategory = {
        category: rawName,
        weight: weightMatch ? parseFloat(weightMatch[1]) : null,
        adjustedWeight: weightMatch ? parseFloat(weightMatch[2]) : null,
        assignments: [],
      };
      gradebook.push(currentCategory);
      afterBoldCategory = false;
      return;
    }

    // Assignment row
    const link = row.querySelector("a#showAssignmentInfo");
    if (link && currentCategory) {
      const cells = row.querySelectorAll("td");
      const date = clean(cells[0]?.textContent || "");
      const name = clean(link.textContent || "");
      const assignmentGrade = toInt(cells[2]?.textContent || "");
      const assignmentScore = toFloat(cells[3]?.textContent || "");
      const pointsText = clean(cells[4]?.textContent || "");
      let points = null;
      const pm = pointsText.match(/(-?\d+(?:\.\d+)?)\s*out of\s*(-?\d+(?:\.\d+)?)/i);
      if (pm) {
        points = { earned: parseFloat(pm[1]), total: parseFloat(pm[2]) };
      }
      const meta = [];
      const missingTooltip = cells[5]?.getAttribute('tooltip');
      if (missingTooltip) meta.push({ type: "missing", note: missingTooltip });
      const noCountTooltip = cells[6]?.getAttribute('tooltip');
      if (noCountTooltip) meta.push({ type: "noCount", note: noCountTooltip });
      const absentTooltip = cells[7]?.getAttribute('tooltip');
      if (absentTooltip) meta.push({ type: "absent", note: absentTooltip });
      currentCategory.assignments.push({
        date,
        name,
        grade: assignmentGrade,
        score: assignmentScore,
        points,
        meta,
      });
    }

    // If next row is not RC1/RC2 or end of rows, assign RC weights to main category if needed
    const nextRow = rows[idx + 1];
    const isNextRC = nextRow && nextRow.classList.contains("sf_Section") && nextRow.classList.contains("cat") &&
      /RC\d/i.test(clean(nextRow.querySelectorAll("td")[1]?.textContent || ""));
    if (lastMainCategory && lastMainCategory.weight == null && rcWeights.length > 0 && !isNextRC) {
      const firstWeight = rcWeights.find(w => w.weight != null);
      if (firstWeight) {
        lastMainCategory.weight = firstWeight.weight;
        lastMainCategory.adjustedWeight = firstWeight.adjustedWeight;
      }
      rcWeights = [];
      afterBoldCategory = false;
    }
  });

    // After all rows, if lastMainCategory still has no weight and rcWeights collected, assign it
    if (lastMainCategory && lastMainCategory.weight == null && rcWeights.length > 0) {
      const firstWeight = rcWeights.find(w => w.weight != null);
      if (firstWeight) {
        lastMainCategory.weight = firstWeight.weight;
        lastMainCategory.adjustedWeight = firstWeight.adjustedWeight;
      }
      rcWeights = [];
    }

    // Filter out categories weighted at 0.00% and with no assignments
    const filteredGradebook = gradebook.filter(cat => !(cat.weight === 0 && (!cat.assignments || cat.assignments.length === 0)));

    return {
      course,
      instructor,
      lit,
      period,
      score: topScore,
      grade: topGrade,
      gradebook: filteredGradebook,
    };
}

// gradeInfoAPI.js
import axios from 'axios';
import qs from 'qs';

class GradeInfo {
  constructor(sessionTokens) {
    this.dwd = sessionTokens.dwd;
    this.wfaacl = sessionTokens.wfaacl;
    this.encses = sessionTokens.encses;
    this.userType = sessionTokens['User-Type'];
    this.sessionid = sessionTokens.sessionid;
  }

  async fetchGradeInfo(params) {
    const {
      stuId,
      entityId,
      corNumId,
      track,
      section,
      gbId,
      bucket,
      dialogLevel,
      customUrl,
      subjectId = '',
      isEoc = 'no',
    } = params;

    const url = customUrl || 'https://skyward-eisdprod.iscorp.com/scripts/wsisa.dll/WService=wsedueanesisdtx/httploader.p?file=sfgradebook001.w';

    const data = {
      action: 'viewGradeInfoDialog',
      gridCount: 1,
      fromHttp: 'yes',
      stuId,
      entityId,
      corNumId,
      track,
      section,
      gbId,
      bucket,
      subjectId,
      dialogLevel,
      isEoc,
      ishttp: 'true',
      sessionid: this.sessionid,
      javascript: 'filesAdded=jquery.1.8.2.js,qsfmain001.css,sfgradebook.css,qsfmain001.min.js,sfgradebook.js,sfprint001.js',
      encses: this.encses,
      dwd: this.dwd,
      wfaacl: this.wfaacl,
      requestId: Date.now(),
    };

    try {
      const response = await axios.post(url + 'httploader.p?file=sfgradebook001.w', qs.stringify(data), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://skyward-eisdprod.iscorp.com',
          'Referer': url,
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0',
          'Cookie': `LoginHistoryIdentifier-stg_jjzapfiqctlLkMda${stuId}=${this.userType}`
        },
      });

      const match = response.data.match(/<output><!\[CDATA\[(.*)\]\]><\/output>/s);
      const html = match && match[1] ? match[1] : response.data;

      fs.writeFileSync('gradeinfo.html', html);

      // Return parsed grade info directly
      return parseGradeInfo(html);
    } catch (err) {
      throw new Error(`Failed to fetch grade info: ${err.message}`);
    }
  }
}

export default GradeInfo;