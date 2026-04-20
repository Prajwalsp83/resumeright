const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5000;
const BASE_URL = "http://52.66.211.217:5000";
const MONGO_URI = "mongodb+srv://prajwalbagalkot83_db_user:ECG1WlTs26vhRlzn@resumeright.unp5mdq.mongodb.net/resumeright?retryWrites=true&w=majority";
const DB_NAME = "resumeright";
const ADMIN_KEY = "resumeright2026";

let db;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── MONGODB ───────────────────────────────────────────────────────────────────
async function connectDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log("✅ MongoDB connected — DB:", DB_NAME);
  } catch (err) {
    console.error("❌ MongoDB failed:", err.message);
    process.exit(1);
  }
}

// ── UPLOADS ───────────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".doc", ".docx"];
    const ext = path.extname(file.originalname).toLowerCase();
    allowed.includes(ext) ? cb(null, true) : cb(new Error("Only PDF/DOC/DOCX allowed"));
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get("/", async (req, res) => {
  try {
    const leads = await db.collection("leads").countDocuments();
    const users = await db.collection("users").countDocuments();
    res.json({ status: "ResumeRight Backend Running 🚀", leads, users, db: DB_NAME });
  } catch (e) {
    res.json({ status: "Running but DB error", error: e.message });
  }
});

// ── SUBMIT LEAD ───────────────────────────────────────────────────────────────
app.post("/submit", async (req, res) => {
  try {
    const { name, phone, email, service, exp, current, target, message } = req.body;
    if (!name || !phone || !email) return res.status(400).json({ error: "Name, phone, email required" });
    const lead = {
      name, phone, email,
      service: service || req.body.pkg || "Not specified",
      exp: exp || "",
      current: current || "",
      target: target || "",
      message: message || "",
      status: "New",
      submitted: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      createdAt: new Date()
    };
    const result = await db.collection("leads").insertOne(lead);
    console.log("✅ Lead saved:", name, email, service);
    res.json({ success: true, id: result.insertedId });
  } catch (e) {
    console.error("Submit error:", e.message);
    res.status(500).json({ error: "Failed to save lead" });
  }
});

// ── REGISTER ──────────────────────────────────────────────────────────────────
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "All fields required" });
    const existing = await db.collection("users").findOne({ email });
    if (existing) return res.status(409).json({ error: "Email already exists" });
    const result = await db.collection("users").insertOne({ name, email, password, createdAt: new Date() });
    console.log("👤 User registered:", name, email);
    res.json({ success: true, user: { id: result.insertedId, name, email } });
  } catch (e) {
    res.status(500).json({ error: "Registration failed" });
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.collection("users").findOne({ email, password });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    res.json({ success: true, user: { id: user._id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(500).json({ error: "Login failed" });
  }
});

// ── UPLOAD RESUME ─────────────────────────────────────────────────────────────
app.post("/upload", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const fileUrl = `${BASE_URL}/uploads/${req.file.filename}`;
    const doc = {
      originalName: req.file.originalname,
      savedAs: req.file.filename,
      fileUrl,
      uploadedBy: req.body.email || "anonymous",
      name: req.body.name || req.body.email || "via-upload",
      email: req.body.email || "",
      phone: req.body.phone || "",
      service: "Resume Upload",
      status: "Resume Uploaded",
      submitted: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      createdAt: new Date()
    };
    await db.collection("leads").insertOne(doc);
    console.log("📄 Resume uploaded:", req.file.originalname);
    res.json({ success: true, fileUrl });
  } catch (e) {
    res.status(500).json({ error: "Upload failed" });
  }
});

// ── ADMIN: GET ALL LEADS ──────────────────────────────────────────────────────
app.get("/admin/leads", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  try {
    const leads = await db.collection("leads").find({}).sort({ createdAt: -1 }).toArray();
    res.json({ leads: leads.map(l => ({ ...l, id: l._id.toString() })), total: leads.length });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// ── ADMIN: GET ALL USERS ──────────────────────────────────────────────────────
app.get("/admin/users", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  try {
    const users = await db.collection("users").find({}, { projection: { password: 0 } }).sort({ createdAt: -1 }).toArray();
    res.json({ users: users.map(u => ({ ...u, id: u._id.toString() })), total: users.length });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ── ADMIN: UPDATE LEAD STATUS ─────────────────────────────────────────────────
app.patch("/admin/leads/:id", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  try {
    await db.collection("leads").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: req.body.status } }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: "Update failed" });
  }
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// ── START ─────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔐 Admin: http://localhost:${PORT}/admin/leads?key=${ADMIN_KEY}`);
  });
});
