// D3 — real-time activity ticker source.
// Holds the socket.io `/activity` namespace and emits social-proof events to all
// connected clients. Real events come from successful ATS scans / video pitches
// (last name + phone are stripped by the caller). During quiet periods it seeds
// synthetic-but-realistic events so the ticker is never empty — these are clearly
// flagged `synthetic: true` for ops sanity.

let nsp = null;
let lastRealAt = 0;
let seeder = null;

// Real-feeling Indian first names + tier-1/2 cities for the synthetic stream.
const FIRST_NAMES = [
  'Pratik', 'Aarav', 'Priya', 'Sneha', 'Rohan', 'Ananya', 'Vikram', 'Neha',
  'Karan', 'Divya', 'Aditya', 'Pooja', 'Rahul', 'Ishita', 'Siddharth', 'Meera',
  'Arjun', 'Kavya', 'Nikhil', 'Riya', 'Aman', 'Tanvi', 'Harsh', 'Sana', 'Varun',
];
const CITIES = [
  'Pune', 'Bengaluru', 'Hyderabad', 'Mumbai', 'Delhi', 'Chennai', 'Gurugram',
  'Noida', 'Ahmedabad', 'Jaipur', 'Indore', 'Kochi', 'Coimbatore', 'Chandigarh',
  'Nagpur', 'Lucknow', 'Bhopal', 'Surat', 'Vadodara', 'Visakhapatnam',
];
const pick = a => a[Math.floor(Math.random() * a.length)];

// Quiet-period gap before we start seeding synthetic events.
const QUIET_MS = 30 * 1000;
const SEED_EVERY_MS = 7 * 1000;

function setIo(io) {
  nsp = io.of('/activity');

  seeder = setInterval(() => {
    if (!nsp) return;
    if (Date.now() - lastRealAt < QUIET_MS) return; // real traffic is flowing
    const isScan = Math.random() < 0.7;
    nsp.emit('activity', isScan
      ? { type: 'ats_scan',    firstName: pick(FIRST_NAMES), city: pick(CITIES), score: 60 + Math.floor(Math.random() * 38), synthetic: true, ts: Date.now() }
      : { type: 'video_pitch', firstName: pick(FIRST_NAMES), city: pick(CITIES),                                              synthetic: true, ts: Date.now() }
    );
  }, SEED_EVERY_MS);
  seeder.unref(); // don't keep the process alive on its own
}

// Caller passes already-anonymised fields (firstName only — no last name/phone).
function emitActivity(evt) {
  lastRealAt = Date.now();
  if (nsp) nsp.emit('activity', { ...evt, synthetic: false, ts: Date.now() });
}

module.exports = { setIo, emitActivity };
