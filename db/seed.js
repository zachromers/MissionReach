const { initialize, getDb } = require('./database');

const firstNames = [
  'James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth',
  'William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen',
  'Christopher','Lisa','Daniel','Nancy','Matthew','Betty','Anthony','Margaret','Mark','Sandra',
  'Donald','Ashley','Steven','Dorothy','Paul','Kimberly','Andrew','Emily','Joshua','Donna',
  'Kenneth','Michelle','Kevin','Carol','Brian','Amanda','George','Melissa','Timothy','Deborah',
  'Ronald','Stephanie','Edward','Rebecca','Jason','Sharon','Jeffrey','Laura','Ryan','Cynthia',
  'Jacob','Kathleen','Gary','Amy','Nicholas','Angela','Eric','Shirley','Jonathan','Anna',
  'Stephen','Brenda','Larry','Pamela','Justin','Emma','Scott','Nicole','Brandon','Helen',
  'Benjamin','Samantha','Samuel','Katherine','Gregory','Christine','Alexander','Debra','Frank','Rachel',
  'Patrick','Carolyn','Raymond','Janet','Jack','Catherine','Dennis','Maria','Jerry','Heather',
];

const lastNames = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
  'Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin',
  'Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson',
  'Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores',
  'Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts',
  'Phillips','Evans','Turner','Diaz','Parker','Cruz','Edwards','Collins','Reyes','Stewart',
  'Morris','Morales','Murphy','Cook','Rogers','Gutierrez','Ortiz','Morgan','Cooper','Peterson',
  'Bailey','Reed','Kelly','Howard','Ramos','Kim','Cox','Ward','Richardson','Watson',
  'Brooks','Chavez','Wood','James','Bennett','Gray','Mendoza','Ruiz','Hughes','Price',
  'Alvarez','Castillo','Sanders','Patel','Myers','Long','Ross','Foster','Jimenez','Powell',
];

const organizations = [
  'Grace Community Church','First Baptist Church','Calvary Chapel','Hope Fellowship',
  'New Life Church','Redeemer Presbyterian','Christ the King','Harvest Bible Chapel',
  'Cornerstone Church','Living Water Fellowship','Faith Community Church','Bethel Church',
  'Trinity Lutheran','St. Andrews Presbyterian','Crossroads Church','The Village Church',
  'Northpoint Community','Saddleback Church','Elevation Church','Gateway Church',
  'Community Bible Church','Riverside Fellowship','Mountain View Church','Oak Hills Church',
  'Lakeview Baptist','Cedar Creek Church','Willow Creek','Chapel Hill Bible Church',
  'Parkside Church','Desert Springs Church','','','','','','',
];

const relationships = [
  'church member','church member','church member','church member',
  'friend','friend','friend',
  'family','family',
  'colleague','colleague',
  'prayer partner','prayer partner','prayer partner',
  'pastor','missions committee',
  'neighbor','mentor','small group leader',
];

const tagSets = [
  'monthly donor,prayer partner',
  'monthly donor',
  'one-time donor',
  'one-time donor,church',
  'prayer partner',
  'prayer partner,church',
  'church,friend',
  'family',
  'friend',
  'new contact',
  'new contact,church',
  'monthly donor,church',
  'one-time donor,prayer partner',
  'friend,prayer partner',
  'church',
  '',
  '',
];

const cities = [
  ['Dallas','TX','75201'],['Austin','TX','78701'],['Houston','TX','77001'],
  ['Nashville','TN','37201'],['Atlanta','GA','30301'],['Charlotte','NC','28201'],
  ['Orlando','FL','32801'],['Jacksonville','FL','32099'],['Tampa','FL','33601'],
  ['Phoenix','AZ','85001'],['Denver','CO','80201'],['Seattle','WA','98101'],
  ['Portland','OR','97201'],['San Diego','CA','92101'],['Los Angeles','CA','90001'],
  ['Chicago','IL','60601'],['Indianapolis','IN','46201'],['Columbus','OH','43201'],
  ['Raleigh','NC','27601'],['Richmond','VA','23219'],['Memphis','TN','38101'],
  ['Louisville','KY','40201'],['Oklahoma City','OK','73101'],['Tulsa','OK','74101'],
  ['Boise','ID','83701'],['Salt Lake City','UT','84101'],['Omaha','NE','68101'],
  ['Minneapolis','MN','55401'],['Kansas City','MO','64101'],['St. Louis','MO','63101'],
];

const streets = [
  'Main St','Oak Ave','Elm Dr','Maple Ln','Cedar Blvd','Pine Rd','Walnut St',
  'Cherry Ln','Birch Ave','Willow Way','Spruce Ct','Ash Dr','Hickory Ln',
  'Magnolia Blvd','Peach St','Sycamore Ave','Dogwood Dr','Holly Ln','Ivy Rd',
  'Juniper Way','Laurel St','Poplar Ave','Chestnut Dr','Hazel Ln','Cypress Blvd',
];

const donationMethods = ['check','online','cash','bank transfer','online','online','check'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randDate(startYear, endYear) {
  const y = randInt(startYear, endYear);
  const m = randInt(1, 12);
  const d = randInt(1, 28);
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

async function seed() {
  await initialize();
  const db = getDb();

  // Check if contacts already exist
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM contacts').get();
  if (existing.cnt > 0) {
    console.log(`Database already has ${existing.cnt} contacts. Skipping seed.`);
    return;
  }

  const usedNames = new Set();
  const contacts = [];

  for (let i = 0; i < 150; i++) {
    let first, last, key;
    do {
      first = pick(firstNames);
      last = pick(lastNames);
      key = `${first}|${last}`;
    } while (usedNames.has(key));
    usedNames.add(key);

    const loc = pick(cities);
    const streetNum = randInt(100, 9999);
    const street = pick(streets);

    contacts.push({
      first_name: first,
      last_name: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${pick(['gmail.com','yahoo.com','outlook.com','icloud.com','hotmail.com','church.org','proton.me'])}`,
      phone: `(${randInt(200,999)}) ${randInt(200,999)}-${randInt(1000,9999)}`,
      address_line1: `${streetNum} ${street}`,
      address_line2: Math.random() < 0.15 ? `Apt ${randInt(1,320)}` : null,
      city: loc[0],
      state: loc[1],
      zip: loc[2],
      country: 'US',
      organization: pick(organizations) || null,
      relationship: pick(relationships),
      notes: null,
      tags: pick(tagSets) || null,
    });
  }

  // Insert contacts
  const insertContact = db.prepare(`
    INSERT INTO contacts (first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country, organization, relationship, notes, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const c of contacts) {
    insertContact.run(
      c.first_name, c.last_name, c.email, c.phone,
      c.address_line1, c.address_line2, c.city, c.state, c.zip, c.country,
      c.organization, c.relationship, c.notes, c.tags
    );
  }

  console.log(`Inserted ${contacts.length} contacts.`);

  // Get all contact IDs
  const allContacts = db.prepare('SELECT id, tags FROM contacts').all();

  // Add donations — ~60% of contacts have at least one donation
  let donationCount = 0;
  const insertDonation = db.prepare(
    'INSERT INTO donations (contact_id, amount, date, method, recurring, notes) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const c of allContacts) {
    const tags = c.tags || '';
    const isMonthly = tags.includes('monthly donor');
    const isOneTime = tags.includes('one-time donor');
    const hasDonation = isMonthly || isOneTime || Math.random() < 0.3;

    if (!hasDonation) continue;

    if (isMonthly) {
      // Monthly donors: 3-18 months of donations
      const months = randInt(3, 18);
      const amount = pick([25, 50, 75, 100, 150, 200, 250, 500]);
      const method = pick(donationMethods);
      for (let m = 0; m < months; m++) {
        const date = new Date();
        date.setMonth(date.getMonth() - m);
        const dateStr = date.toISOString().split('T')[0];
        insertDonation.run(c.id, amount, dateStr, method, 1, null);
        donationCount++;
      }
    } else {
      // One-time or occasional donors: 1-4 donations
      const count = randInt(1, 4);
      for (let d = 0; d < count; d++) {
        const amount = pick([25, 50, 100, 150, 200, 250, 500, 1000, 2500, 5000]);
        const date = randDate(2024, 2026);
        insertDonation.run(c.id, amount, date, pick(donationMethods), 0, null);
        donationCount++;
      }
    }
  }

  console.log(`Inserted ${donationCount} donations.`);

  // Add outreaches — varying amounts per contact
  let outreachCount = 0;
  const insertOutreach = db.prepare(
    'INSERT INTO outreaches (contact_id, mode, direction, subject, content, date, ai_generated, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const outreachSubjects = [
    'Monthly update','Thank you note','Prayer request follow-up','Checking in',
    'Ministry update','Holiday greetings','Birthday wishes','Invitation to event',
    'Support acknowledgment','Newsletter follow-up','Trip report','Coffee catch-up',
    'Phone call follow-up','Welcome message','Year-end thank you',
  ];

  const outreachContents = [
    'Shared our latest ministry update and prayer requests.',
    'Thanked them for their generous support and prayers.',
    'Followed up on a prayer request they shared with us.',
    'Checked in to see how they are doing and share life updates.',
    'Sent our quarterly newsletter with field updates.',
    'Wished them a wonderful holiday season.',
    'Sent birthday greetings and a personal note.',
    'Invited them to our upcoming fundraising dinner.',
    'Acknowledged their recent donation with a personal thank you.',
    'Discussed upcoming mission trip plans.',
    'Shared photos and stories from our recent trip.',
    'Met for coffee to catch up and share about the ministry.',
    'Left a voicemail checking in. Will try again next week.',
    'Sent a welcome packet with information about our ministry.',
    'Sent year-end giving summary and heartfelt thank you letter.',
  ];

  const modes = ['email','email','email','sms','sms','call','call','letter','in_person','social_media'];

  for (const c of allContacts) {
    // 70% of contacts have outreaches
    if (Math.random() < 0.3) continue;

    const count = randInt(1, 8);
    for (let o = 0; o < count; o++) {
      const mode = pick(modes);
      const daysAgo = randInt(1, 400);
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      const dateStr = date.toISOString();

      insertOutreach.run(
        c.id, mode, 'outgoing',
        pick(outreachSubjects),
        pick(outreachContents),
        dateStr, 0, 'completed'
      );
      outreachCount++;
    }
  }

  console.log(`Inserted ${outreachCount} outreaches.`);
  console.log('Seed complete!');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
