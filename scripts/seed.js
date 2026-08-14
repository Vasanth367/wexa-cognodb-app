// scripts/seed.js
// Generates a realistic-ish synthetic research graph and loads it into
// CognoDB using parameterised, batched Cypher (UNWIND) via the official
// driver. Safe to re-run: it wipes prior data first.
//
// Usage:  npm run seed

require('dotenv').config();
const neo4j = require('neo4j-driver');

const URI = process.env.COGNODB_URI;
const USER = process.env.COGNODB_USER || 'cognodb';
const PASSWORD = process.env.COGNODB_PASSWORD;

if (!URI || !PASSWORD) {
  console.error('Missing COGNODB_URI / COGNODB_PASSWORD. Copy .env.example to .env first.');
  process.exit(1);
}

const TOPICS = [
  'Graph Neural Networks', 'Large Language Models', 'Reinforcement Learning',
  'Distributed Systems', 'Computer Vision', 'Knowledge Graphs',
  'Federated Learning', 'Program Synthesis', 'Robotics', 'Causal Inference',
  'Recommender Systems', 'Natural Language Generation', 'Differential Privacy',
  'Quantum Computing', 'Human-Computer Interaction',
];

const INSTITUTIONS = [
  { name: 'Alderbrook Institute of Technology', country: 'USA' },
  { name: 'University of Kettlewell', country: 'UK' },
  { name: 'Northshore Polytechnic', country: 'Canada' },
  { name: 'Rushmere University', country: 'USA' },
  { name: 'Vantage Research Institute', country: 'Singapore' },
  { name: 'Blackmoor University', country: 'Germany' },
  { name: 'Cascade State University', country: 'USA' },
  { name: 'Eastfield College of Science', country: 'India' },
  { name: 'Solstice Institute', country: 'Australia' },
  { name: 'Marlowe Technical University', country: 'Netherlands' },
  { name: 'Redcliff University', country: 'South Korea' },
  { name: 'Hollowmere Institute', country: 'Japan' },
];

const VENUES = ['NeurIPS', 'ICML', 'ACL', 'CVPR', 'VLDB', 'SIGMOD', 'KDD', 'AAAI', 'ICLR', 'WWW'];

const FIRST_NAMES = ['Amara','Liang','Sofia','Noah','Priya','Kenji','Elena','Marcus','Fatima','Oliver','Yuki','Ines','Tobias','Nadia','Diego','Chloe','Arjun','Maya','Felix','Ana','Ravi','Lena','Omar','Hana','Sam','Zara','Leo','Nina','Theo','Iris'];
const LAST_NAMES = ['Okafor','Zhang','Rossi','Kim','Sharma','Tanaka','Petrova','Dubois','Haddad','Novak','Suzuki','Fernandes','Weber','Ivanov','Torres','Bennett','Rao','Larsen','Costa','Yilmaz','Patel','Andersson','Hassan','Park','Cohen','Nguyen','Muller','Silva','Papadopoulos','Singh'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickSome(arr, min, max) {
  const n = Math.floor(Math.random() * (max - min + 1)) + min;
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
function idOf(prefix, i) { return `${prefix}${String(i).padStart(3, '0')}`; }

function buildGraph() {
  // Institutions
  const institutions = INSTITUTIONS.map((inst, i) => ({ id: idOf('inst', i + 1), ...inst }));

  // Topics
  const topics = TOPICS.map((name, i) => ({ id: idOf('topic', i + 1), name }));

  // Authors
  const NUM_AUTHORS = 42;
  const authors = [];
  for (let i = 1; i <= NUM_AUTHORS; i++) {
    authors.push({
      id: idOf('auth', i),
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      hIndex: Math.floor(Math.random() * 40) + 1,
      joinedYear: 2008 + Math.floor(Math.random() * 15),
      institutionId: pick(institutions).id,
    });
  }

  // Papers, ordered by year so citations only point backward in time
  // (older papers get cited by newer ones -- keeps the CITES graph a DAG).
  const NUM_PAPERS = 95;
  const papers = [];
  for (let i = 1; i <= NUM_PAPERS; i++) {
    const year = 2015 + Math.floor((i / NUM_PAPERS) * 10); // spreads 2015-2024
    papers.push({
      id: idOf('paper', i),
      title: `${pick(['Scalable','Robust','Towards','A Unified','Efficient','Rethinking','On the Limits of','Learning'])} ${pick(['Approach to','Framework for','Analysis of','Method for'])} ${pick(TOPICS)}`,
      year,
      venue: pick(VENUES),
      authorIds: pickSome(authors, 1, 4).map(a => a.id),
      topicIds: pickSome(topics, 1, 2).map(t => t.id),
    });
  }

  // Citations: each paper cites 0-4 earlier papers.
  const citations = [];
  papers.forEach((p, idx) => {
    const earlier = papers.slice(0, idx);
    if (earlier.length === 0) return;
    const cited = pickSome(earlier, 0, Math.min(4, earlier.length));
    cited.forEach(c => citations.push({ from: p.id, to: c.id }));
  });

  return { institutions, topics, authors, papers, citations };
}

async function main() {
  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
  const session = driver.session();

  try {
    await driver.verifyConnectivity();
    console.log('Connected to CognoDB. Seeding...');

    const { institutions, topics, authors, papers, citations } = buildGraph();

    console.log('Wiping existing data...');
    await session.run('MATCH (n) DETACH DELETE n');

    console.log('Creating constraints...');
    await session.run('CREATE CONSTRAINT author_id IF NOT EXISTS FOR (a:Author) REQUIRE a.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT paper_id IF NOT EXISTS FOR (p:Paper) REQUIRE p.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT institution_id IF NOT EXISTS FOR (i:Institution) REQUIRE i.id IS UNIQUE');

    console.log(`Loading ${institutions.length} institutions...`);
    await session.run(
      `UNWIND $rows AS row
       CREATE (:Institution {id: row.id, name: row.name, country: row.country})`,
      { rows: institutions }
    );

    console.log(`Loading ${topics.length} topics...`);
    await session.run(
      `UNWIND $rows AS row
       CREATE (:Topic {id: row.id, name: row.name})`,
      { rows: topics }
    );

    console.log(`Loading ${authors.length} authors + AFFILIATED_WITH...`);
    await session.run(
      `UNWIND $rows AS row
       CREATE (a:Author {id: row.id, name: row.name, hIndex: row.hIndex, joinedYear: row.joinedYear})
       WITH a, row
       MATCH (i:Institution {id: row.institutionId})
       CREATE (a)-[:AFFILIATED_WITH {since: row.joinedYear}]->(i)`,
      { rows: authors }
    );

    console.log(`Loading ${papers.length} papers + WROTE + ABOUT...`);
    await session.run(
      `UNWIND $rows AS row
       CREATE (p:Paper {id: row.id, title: row.title, year: row.year, venue: row.venue})
       WITH p, row
       UNWIND row.authorIds AS authorId
       MATCH (a:Author {id: authorId})
       CREATE (a)-[:WROTE]->(p)`,
      { rows: papers }
    );
    await session.run(
      `UNWIND $rows AS row
       MATCH (p:Paper {id: row.id})
       UNWIND row.topicIds AS topicId
       MATCH (t:Topic {id: topicId})
       CREATE (p)-[:ABOUT]->(t)`,
      { rows: papers }
    );

    console.log(`Loading ${citations.length} CITES relationships...`);
    await session.run(
      `UNWIND $rows AS row
       MATCH (p1:Paper {id: row.from})
       MATCH (p2:Paper {id: row.to})
       CREATE (p1)-[:CITES]->(p2)`,
      { rows: citations }
    );

    console.log('Done. Seed summary:');
    console.log(`  Institutions: ${institutions.length}`);
    console.log(`  Topics:       ${topics.length}`);
    console.log(`  Authors:      ${authors.length}`);
    console.log(`  Papers:       ${papers.length}`);
    console.log(`  Citations:    ${citations.length}`);
    console.log('\nSample author ids for testing:', authors.slice(0, 3).map(a => `${a.id} (${a.name})`).join(', '));
    console.log('Sample paper ids for testing:', papers.slice(0, 3).map(p => `${p.id} (${p.title})`).join(', '));
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    await session.close();
    await driver.close();
  }
}

main();
