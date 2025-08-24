import JSON5 from 'json5';

/**
 * Extract the JSON object from sff.sv('sf_gridObjects', $.extend(..., {...}));
 * 
 * @param {string} html - The HTML string containing the sff.sv call.
 * @returns {Object|null} The parsed JSON object or null if not found or parsing failed.
 */
export function extractSfGridObjectsFromExtend(html) {
  const pattern = /sff\.sv\('sf_gridObjects',\s*\$\.extend\(\s*\(.*?\),\s*(\{[\s\S]*?\})\s*\)\s*\);/m;
  const match = html.match(pattern);
  if (!match) {
    console.log("No sf_gridObjects $.extend data found.");
    return null;
  }

  let objStr = match[1];

  // Remove trailing commas that break JSON parsing
  objStr = objStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

  try {
    const data = JSON5.parse(objStr);
    return data;
  } catch (err) {
    console.error("Failed to parse sf_gridObjects $.extend JSON5:", err);
    return null;
  }
}

