import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from root
app.use(express.static(__dirname));

// Single Active Device Session Store
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
let activeSessions = {};

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      activeSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (e) {
    activeSessions = {};
  }
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(activeSessions, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving sessions:', e.message);
  }
}

loadSessions();

// Function to scan and load villages from JSON folders
function loadVillagesData() {
  const villagesData = {};
  const processedVillages = new Set();

  function scanFolder(dirPath, defaultName) {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;

    let villageName = defaultName;
    const infoFiles = ['info.json', 'village.json', 'গ্রাম.json'];
    for (const infoFile of infoFiles) {
      const p = path.join(dirPath, infoFile);
      if (fs.existsSync(p)) {
        try {
          const info = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (info.name) {
            villageName = info.name;
            break;
          }
        } catch (e) {}
      }
    }

    if (!villageName) villageName = path.basename(dirPath);
    if (processedVillages.has(villageName)) return;

    let maleList = [];
    const maleFileNames = ['male.json', 'purush.json', 'পুরুষ.json', 'males.json', 'men.json'];
    for (const mf of maleFileNames) {
      const p = path.join(dirPath, mf);
      if (fs.existsSync(p)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (Array.isArray(parsed)) {
            maleList = parsed.map(v => ({
              ...v,
              gender: v.gender || 'পুরুষ',
              villageName: villageName
            }));
            break;
          }
        } catch (e) {
          console.error(`Error reading ${p}:`, e.message);
        }
      }
    }

    let femaleList = [];
    const femaleFileNames = ['female.json', 'nari.json', 'মহিলা.json', 'females.json', 'women.json'];
    for (const ff of femaleFileNames) {
      const p = path.join(dirPath, ff);
      if (fs.existsSync(p)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (Array.isArray(parsed)) {
            femaleList = parsed.map(v => ({
              ...v,
              gender: v.gender || 'মহিলা',
              villageName: villageName
            }));
            break;
          }
        } catch (e) {
          console.error(`Error reading ${p}:`, e.message);
        }
      }
    }

    if (maleList.length > 0 || femaleList.length > 0) {
      villagesData[villageName] = [...maleList, ...femaleList];
      processedVillages.add(villageName);
    }
  }

  // 1. Scan /villages subdirectories
  const villagesDir = path.join(__dirname, 'villages');
  if (fs.existsSync(villagesDir)) {
    const entries = fs.readdirSync(villagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('_')) {
        scanFolder(path.join(villagesDir, entry.name), entry.name);
      }
    }
  }

  // 2. Scan root folders (like ./pathamara, ./cotobadura)
  const ignoredRoot = new Set(['node_modules', '.git', 'villages', 'public', 'dist', 'build']);
  const rootEntries = fs.readdirSync(__dirname, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isDirectory() && !ignoredRoot.has(entry.name) && !entry.name.startsWith('.')) {
      scanFolder(path.join(__dirname, entry.name), entry.name);
    }
  }

  return villagesData;
}

// API endpoint to get all voter data loaded from JSON files
app.get('/api/villages-data', (req, res) => {
  try {
    const data = loadVillagesData();
    res.json(data);
  } catch (err) {
    console.error('Error fetching villages data:', err);
    res.status(500).json({ error: 'Failed to load villages data' });
  }
});

// API endpoint to get summary list of villages
app.get('/api/villages', (req, res) => {
  try {
    const data = loadVillagesData();
    const summary = Object.keys(data).map(village => {
      const voters = data[village];
      const males = voters.filter(v => v.gender === 'পুরুষ').length;
      const females = voters.filter(v => v.gender === 'মহিলা').length;
      return {
        name: village,
        total: voters.length,
        males,
        females
      };
    });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load villages summary' });
  }
});

// Single Active Device Session API
// 1. Register or takeover active session for an email
app.post('/api/session/register', (req, res) => {
  const { email, sessionId, deviceName } = req.body || {};
  if (!email || !sessionId) {
    return res.status(400).json({ error: 'Email and sessionId are required' });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  activeSessions[cleanEmail] = {
    sessionId: String(sessionId),
    email: cleanEmail,
    deviceName: deviceName || 'Mobile',
    registeredAt: Date.now(),
    lastActive: Date.now()
  };
  saveSessions();
  res.json({ success: true, sessionId: String(sessionId) });
});

// 2. Validate whether current session is still the single active session
app.get('/api/session/validate', (req, res) => {
  const email = req.query.email;
  const sessionId = req.query.sessionId;

  if (!email || !sessionId) {
    return res.status(400).json({ isValid: false, reason: 'missing_params' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const current = activeSessions[cleanEmail];

  if (!current) {
    // If no session recorded yet, adopt this current session
    activeSessions[cleanEmail] = {
      sessionId: String(sessionId),
      email: cleanEmail,
      registeredAt: Date.now(),
      lastActive: Date.now()
    };
    saveSessions();
    return res.json({ isValid: true });
  }

  if (current.sessionId === String(sessionId)) {
    current.lastActive = Date.now();
    return res.json({ isValid: true });
  }

  // Another device logged in and took over!
  return res.json({
    isValid: false,
    reason: 'another_device_logged_in',
    registeredAt: current.registeredAt
  });
});

// 3. Terminate session on manual logout
app.post('/api/session/logout', (req, res) => {
  const { email, sessionId } = req.body || {};
  if (email) {
    const cleanEmail = String(email).trim().toLowerCase();
    if (activeSessions[cleanEmail] && (!sessionId || activeSessions[cleanEmail].sessionId === String(sessionId))) {
      delete activeSessions[cleanEmail];
      saveSessions();
    }
  }
  res.json({ success: true });
});

// Route handlers
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, 'search.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
