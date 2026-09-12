#!/bin/bash
# MongoDB Migration Setup Script
# Run this script to set up MongoDB for your SMM Panel project

set -e

echo "=========================================="
echo "MongoDB Setup & Migration Script"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check Node.js
echo -e "${BLUE}[1/5] Checking Node.js installation...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found. Please install Node.js first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v) found${NC}"
echo ""

# Step 2: Check MongoDB
echo -e "${BLUE}[2/5] Checking MongoDB connection...${NC}"
if command -v mongod &> /dev/null; then
    echo -e "${GREEN}✓ MongoDB is installed${NC}"
else
    echo -e "${YELLOW}⚠ MongoDB CLI tools not found locally${NC}"
    echo "  You can use MongoDB Atlas or Docker instead"
fi
echo ""

# Step 3: Install dependencies
echo -e "${BLUE}[3/5] Installing Mongoose dependencies...${NC}"
npm install mongoose @types/mongoose --save
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 4: Create .env backup
echo -e "${BLUE}[4/5] Setting up environment variables...${NC}"
if [ ! -f .env.local ]; then
    echo -e "${YELLOW}Creating .env.local...${NC}"
    cat > .env.local << 'EOF'
# MongoDB Connection String
# Local development: mongodb://localhost:27017/smm-panel
# MongoDB Atlas: mongodb+srv://username:password@cluster.mongodb.net/smm-panel
MONGODB_URI=mongodb://localhost:27017/smm-panel

EOF
    echo -e "${GREEN}✓ .env.local created - please update MONGODB_URI${NC}"
else
    echo -e "${YELLOW}✓ .env.local already exists${NC}"
fi
echo ""

# Step 5: Create directories and files
echo -e "${BLUE}[5/5] Verifying migration files...${NC}"
MIGRATION_FILES=(
    "src/db/mongodb-schema.ts"
    "src/db/mongodb-examples.ts"
    "src/db/mongodb-queries.ts"
    "src/db/MIGRATION_QUICK_START.ts"
    "MONGODB_MIGRATION.md"
)

for file in "${MIGRATION_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ $file${NC}"
    else
        echo -e "${YELLOW}⚠ $file not found${NC}"
    fi
done
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Next Steps:"
echo "1. Update MONGODB_URI in .env.local"
echo "2. Start MongoDB:"
echo "   - Local: mongod"
echo "   - Docker: docker run -d -p 27017:27017 mongo"
echo "   - Atlas: Use connection string from Atlas console"
echo ""
echo "3. Review migration documentation:"
echo "   - MONGODB_MIGRATION.md (complete guide)"
echo "   - src/db/MIGRATION_QUICK_START.ts (implementation phases)"
echo "   - src/db/mongodb-queries.ts (query patterns)"
echo ""
echo "4. Run data migration:"
echo "   - npx ts-node scripts/migrate-postgres-to-mongodb.ts"
echo ""
echo "5. Update API routes to use Mongoose"
echo ""
echo "6. Test thoroughly before production deployment"
echo ""
echo "=========================================="
