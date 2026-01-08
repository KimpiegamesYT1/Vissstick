#!/bin/bash

# Hok Dashboard Start Script
# Controleert dependencies en start de server

echo "🚀 Starting Hok Dashboard..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is niet geïnstalleerd!"
    echo "   Installeer Node.js vanaf: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if database exists
if [ ! -f "../bot.db" ]; then
    echo "⚠️  Waarschuwing: bot.db niet gevonden in parent directory"
    echo "   Het dashboard heeft toegang nodig tot de bot database"
    echo ""
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Dependencies niet gevonden, installeren..."
    npm install
    echo ""
fi

# Start server
echo "🌐 Starting server op http://localhost:3000"
echo "   Druk CTRL+C om te stoppen"
echo ""

npm start
