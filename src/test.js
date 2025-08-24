// test.js
// Usage: node src/test.js
// This script authenticates, then calls the /grade-info endpoint with correct parameters.

import axios from 'axios';
import { getNewSessionCodes, parsePostResponse } from './auth.js';
import 'dotenv/config';


const BACKEND_URL = 'http://localhost:3000'; // Change if your backend runs elsewhere
const SKYWARD_BASE_URL = process.env.SKYWARD_BASEURL || 'https://skyward-eisdprod.iscorp.com/scripts/wsisa.dll/WService=wsedueanesisdtx/';
const USERNAME = process.env.SKYWARD_USER;
const PASSWORD = process.env.SKYWARD_PASS;

async function main() {
  try {
    // Step 1: Authenticate and get session codes
    if (!USERNAME || !PASSWORD) {
      throw new Error('Please set SKYWARD_USER and SKYWARD_PASS environment variables.');
    }
    console.log('Authenticating...');
    const sessionCodes = await getNewSessionCodes(USERNAME, PASSWORD, SKYWARD_BASE_URL);
    console.log('Session codes:', sessionCodes);

  const response = await axios.post(`${BACKEND_URL}/scrape-report`, {
    dwd: sessionCodes.dwd,
    encses: sessionCodes.encses,
    wfaacl: sessionCodes.wfaacl,
    sessionid: sessionCodes.sessionid,
    'User-Type': sessionCodes['User-Type'],
    baseUrl: SKYWARD_BASE_URL
  });
    // const params = {
    //     stuId: '130220', // Essential Student ID (Per student)
    //     corNumId: '86362', // Essential Course NUM ID (Per class)
    //     section: '26', // Essential (Per class)
    //     gbId: '2716956', // Essential Grade book ID (Per class)
    //     bucket: 'TERM 1', // Essential
    //     customUrl: SKYWARD_BASE_URL,
    // };

    // // Step 3: Call /grade-info endpoint
    // console.log('Calling /grade-info...');
    // const response = await axios.post(`${BACKEND_URL}/grade-info`, {
    //   sessionTokens: sessionCodes,
    //   params,
    // });
    console.log('Grade info response:', JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error('Test failed:', err);
  }
}

main();
