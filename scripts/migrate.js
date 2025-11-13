/**
 * Migratie script om oude JSON data naar SQLite database te migreren
 * Voer dit script eenmalig uit om alle bestaande data over te zetten
 */

const fs = require('fs');
const path = require('path');
const { initDatabase, getDatabase } = require('../database');

console.log('🔄 Start data migratie naar SQLite...\n');

// Initialiseer database
try {
  initDatabase();
  console.log('✅ Database geïnitialiseerd\n');
} catch (error) {
  console.error('❌ Kon database niet initialiseren:', error);
  process.exit(1);
}

const db = getDatabase();

// Helper functie om JSON file te lezen
function readJSONFile(filename) {
  const filePath = path.join(__dirname, '..', filename);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn(`⚠️  Kon ${filename} niet lezen:`, error.message);
  }
  return null;
}

// 1. Migreer quiz vragen
console.log('📝 Migreer quiz vragen...');
const quizlijst = readJSONFile('quizlijst.json');
if (quizlijst && Array.isArray(quizlijst)) {
  const stmt = db.prepare(`
    INSERT INTO quiz_questions (vraag, optie_a, optie_b, optie_c, optie_d, correct_antwoord)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const usedQuestions = readJSONFile('used-questions.json') || [];
  
  let inserted = 0;
  quizlijst.forEach(q => {
    try {
      stmt.run(
        q.vraag,
        q.opties.A,
        q.opties.B,
        q.opties.C,
        q.opties.D,
        q.antwoord
      );
      inserted++;
    } catch (error) {
      // Vraag bestaat al (duplicate), negeer
      if (!error.message.includes('UNIQUE constraint')) {
        console.warn(`  ⚠️  Fout bij vraag "${q.vraag.substring(0, 30)}...":`, error.message);
      }
    }
  });
  
  console.log(`  ✓ ${inserted} quiz vragen toegevoegd`);
  
  // Markeer gebruikte vragen
  if (usedQuestions.length > 0) {
    const markUsedStmt = db.prepare(`
      UPDATE quiz_questions
      SET is_used = 1, used_date = datetime('now')
      WHERE vraag = ? AND optie_a = ?
    `);
    
    let marked = 0;
    usedQuestions.forEach(q => {
      try {
        const result = markUsedStmt.run(q.vraag, q.opties.A);
        if (result.changes > 0) marked++;
      } catch (error) {
        // Negeer fouten
      }
    });
    
    console.log(`  ✓ ${marked} vragen gemarkeerd als gebruikt`);
  }
} else {
  console.log('  ⚠️  Geen quizlijst.json gevonden of leeg');
}

// 2. Migreer quiz scores
console.log('\n📊 Migreer quiz scores...');
const quizScores = readJSONFile('quiz-scores.json');
if (quizScores) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO quiz_scores (user_id, username, month_key, correct_count, total_count)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  let inserted = 0;
  
  // Monthly scores
  if (quizScores.monthly) {
    Object.entries(quizScores.monthly).forEach(([monthKey, users]) => {
      Object.entries(users).forEach(([userId, data]) => {
        try {
          stmt.run(userId, data.username, monthKey, data.correct || 0, data.total || 0);
          inserted++;
        } catch (error) {
          console.warn(`  ⚠️  Fout bij score voor user ${userId}:`, error.message);
        }
      });
    });
  }
  
  // All-time scores
  if (quizScores.allTime) {
    Object.entries(quizScores.allTime).forEach(([userId, data]) => {
      try {
        stmt.run(userId, data.username, 'all-time', data.correct || 0, data.total || 0);
        inserted++;
      } catch (error) {
        console.warn(`  ⚠️  Fout bij all-time score voor user ${userId}:`, error.message);
      }
    });
  }
  
  console.log(`  ✓ ${inserted} quiz scores toegevoegd`);
} else {
  console.log('  ⚠️  Geen quiz-scores.json gevonden');
}

// 3. Migreer hok data
console.log('\n🏠 Migreer hok geschiedenis...');
const hokData = readJSONFile('data.json');
if (hokData && hokData.openingTimes) {
  const stmt = db.prepare(`
    INSERT INTO hok_status_log (date_key, time_logged, is_opening)
    VALUES (?, ?, ?)
  `);
  
  let inserted = 0;
  
  Object.entries(hokData.openingTimes).forEach(([dateKey, times]) => {
    // Migreer opening times
    if (times.openTimes && Array.isArray(times.openTimes)) {
      times.openTimes.forEach(time => {
        try {
          stmt.run(dateKey, time, 1);
          inserted++;
        } catch (error) {
          if (!error.message.includes('UNIQUE constraint')) {
            console.warn(`  ⚠️  Fout bij hok opening ${dateKey} ${time}:`, error.message);
          }
        }
      });
    }
    
    // Migreer closing times
    if (times.closeTimes && Array.isArray(times.closeTimes)) {
      times.closeTimes.forEach(time => {
        try {
          stmt.run(dateKey, time, 0);
          inserted++;
        } catch (error) {
          if (!error.message.includes('UNIQUE constraint')) {
            console.warn(`  ⚠️  Fout bij hok closing ${dateKey} ${time}:`, error.message);
          }
        }
      });
    }
  });
  
  console.log(`  ✓ ${inserted} hok status logs toegevoegd`);
} else {
  console.log('  ⚠️  Geen data.json gevonden of leeg');
}

// 4. Check actieve quizzes (waarschuwing)
console.log('\n⚠️  Actieve quizzes worden NIET gemigreerd');
console.log('   Deze worden automatisch opnieuw gestart bij bot startup\n');

// Vacuüm database voor optimalisatie
console.log('🧹 Optimaliseer database...');
db.exec('VACUUM');

console.log('\n✅ Migratie voltooid!\n');

// Toon statistieken
console.log('📈 Database statistieken:');
const stats = {
  questions: db.prepare('SELECT COUNT(*) as count FROM quiz_questions').get().count,
  used: db.prepare('SELECT COUNT(*) as count FROM quiz_questions WHERE is_used = 1').get().count,
  scores: db.prepare('SELECT COUNT(*) as count FROM quiz_scores').get().count,
  hokLogs: db.prepare('SELECT COUNT(*) as count FROM hok_status_log').get().count
};

console.log(`  • Quiz vragen: ${stats.questions} (${stats.used} gebruikt)`);
console.log(`  • Quiz scores: ${stats.scores}`);
console.log(`  • Hok logs: ${stats.hokLogs}`);

console.log('\n💡 Je kunt nu de bot starten met: npm start');
console.log('   De oude JSON files kun je als backup bewaren of verwijderen.\n');

process.exit(0);
