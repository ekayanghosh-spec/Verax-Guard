import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import CryptoJS from 'crypto-js';
import crypto from 'crypto'; // <--- THIS IS THE MISSING PIECE

dotenv.config();

const app = express();
// ... the rest of the code stays exactly the same
app.use(cors()); 
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

if (!process.env.GEMINI_API_KEY) {
  console.error("CRITICAL ERROR: GEMINI_API_KEY missing in .env file.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- NEW TEST ROUTE ---
// This lets us test if the server is actually awake in your browser
app.get('/', (req, res) => {
  res.send("VERAX VAULT IS ALIVE AND READY ON PORT 5005");
});

app.post('/api/audit', upload.single('invoice'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const fileData = {
      inlineData: {
        data: req.file.buffer.toString("base64"),
        mimeType: req.file.mimetype,
      },
    };

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `You are a strict ZATCA Phase 2 Auditor. Extract the following from the invoice image:
    vendor (string name), vatId (string, the 15 digit number), total (number, the final amount), statedVat (number, the tax amount).
    Return ONLY a raw JSON object. No markdown, no extra text. Format: {"vendor": "Name", "vatId": "123", "total": 100, "statedVat": 15}`;

    const aiRes = await model.generateContent([fileData, prompt]);
    const responseText = aiRes.response.text().replace(/```json|```/g, "").trim();
    const data = JSON.parse(responseText);

    const total = parseFloat(data.total) || 0;
    const statedVat = parseFloat(data.statedVat) || 0;
    const vatIdStr = String(data.vatId).trim().replace(/\s/g, ''); 
    
    const subtotal = total / 1.15;
    const expectedVat = parseFloat((total - subtotal).toFixed(2));
    
    const isVatValid = Math.abs(expectedVat - statedVat) <= 0.05;
    const isTaxIdValid = vatIdStr.length === 15 && vatIdStr.startsWith('3') && vatIdStr.endsWith('3');

    const isCompliant = isVatValid && isTaxIdValid;

    const genUuid = crypto.randomUUID();
    const genHash = CryptoJS.SHA256(data.vendor + total + genUuid).toString();

    res.json({
      vendor: data.vendor,
      vatId: vatIdStr,
      total: total.toFixed(2),
      statedVat: statedVat.toFixed(2),
      expectedVat: expectedVat.toFixed(2),
      isVatValid,
      isTaxIdValid,
      status: isCompliant ? 'COMPLIANT' : 'NON-COMPLIANT',
      hash: genHash,
      uuid: genUuid
    });

  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: "System Fault: Unable to read invoice or establish cryptography." });
  }
});

// --- CHANGED PORT TO 5005 TO DODGE GHOST SERVERS ---
const PORT = process.env.PORT || 5005;
app.listen(PORT, () => console.log(`Verax Secure Node Active on port ${PORT}`));