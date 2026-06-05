const {google} = require('googleapis');

const SCRIPT_IDS = {
  'MR Approval Updater': 'YOUR_SCRIPT_ID_1',
  'Merge Requests Status Sync': 'YOUR_SCRIPT_ID_2',
};

async function updateScript(auth, scriptId, title, code, manifest) {
  const script = google.script({version: 'v1', auth});

  const content = {
    files: [
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: code,
      },
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify(manifest, null, 2),
      },
    ],
  };

  await script.projects.updateContent({
    scriptId,
    requestBody: content,
  });
  console.log(`✓ Updated ${title}`);
}

async function main() {
  const code1 = require('fs').readFileSync(require('path').join(__dirname, 'mr_approval_updater.js'), 'utf8');
  const code2 = require('fs').readFileSync(require('path').join(__dirname, 'mr_status_sync.js'), 'utf8');

  const manifest = {
    timeZone: 'Europe/Helsinki',
    dependencies: {},
    exceptionLogging: 'STACKDRIVER',
    runtimeVersion: 'V8',
  };

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/script.projects'],
  });

  const client = await auth.getClient();
  console.log('Auth OK, updating scripts...');

  await updateScript(auth, SCRIPT_IDS['MR Approval Updater'], 'MR Approval Updater', code1, manifest);
  await updateScript(auth, SCRIPT_IDS['Merge Requests Status Sync'], 'Merge Requests Status Sync', code2, manifest);

  console.log('All scripts updated!');
}

main().catch(console.error);
