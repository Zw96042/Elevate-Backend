import { JSDOM } from "jsdom";
import  fs from 'fs';

// Parser for Skyward grade info HTML/JS response
export function parseGradeInfo(html) {
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

  rows.forEach((row) => {
    // Category row
    if (row.classList.contains("sf_Section") && row.classList.contains("cat")) {
      const cells = row.querySelectorAll("td");
      const nameNode = cells[1]?.childNodes?.[0];
      const rawName = clean(nameNode?.textContent || cells[1]?.textContent || "");
      const weightSpan = clean(cells[1]?.querySelector("span")?.textContent || "");
      const weightMatch = weightSpan.match(/weighted at ([\d.]+)%, adjusted to ([\d.]+)%/i);

      currentCategory = {
        category: rawName,
        weight: weightMatch ? parseFloat(weightMatch[1]) : null,
        adjustedWeight: weightMatch ? parseFloat(weightMatch[2]) : null,
        assignments: [],
      };
      gradebook.push(currentCategory);
      return;
    }

    // Assignment row
    const link = row.querySelector("a#showAssignmentInfo");
    if (link && currentCategory) {
      const cells = row.querySelectorAll("td");
      // Expected columns for assignment rows:
      // 0: Due (colspan=2)
      // 1: Assignment name
      // 2: Grade (int, e.g., 97)
      // 3: Score (double percent, e.g., 97.00)
      // 4: Points Earned (e.g., "48.5 out of 50")
      // 5: Missing
      // 6: No Count
      // 7: Absent

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
      const missingText = clean(cells[5]?.textContent || "");
      if (missingText) meta.push({ type: "missing", note: missingText });

      const noCountText = clean(cells[6]?.textContent || "");
      if (noCountText) meta.push({ type: "nocount", note: noCountText });

      const absentText = clean(cells[7]?.textContent || "");
      if (absentText) meta.push({ type: "absent", note: absentText });

      currentCategory.assignments.push({
        date,
        name,
        grade: assignmentGrade,     // int
        score: assignmentScore,     // double
        points,                     // { earned: double, total: double } | null
        meta,                       // [] when none
      });
    }
  });

  return {
    course,
    instructor,
    lit,
    period,
    score: topScore,
    grade: topGrade,
    gradebook,
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

      // fs.writeFileSync('gradeinfo.html', html);

      // Return parsed grade info directly
      return parseGradeInfo(html);
    } catch (err) {
      throw new Error(`Failed to fetch grade info: ${err.message}`);
    }
  }
}

export default GradeInfo;