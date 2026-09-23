import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Serve static assets from root
app.use(express.static(__dirname));

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
