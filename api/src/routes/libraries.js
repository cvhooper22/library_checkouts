const express = require('express');
const prisma = require('@library-tracker/db');

const router = express.Router();

// Supported libraries for the "add an account" picker. Only what the picker
// needs — baseUrl and scraperTypeDefault stay server-side.
router.get('/', async (req, res) => {
  const libraries = await prisma.library.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true },
  });
  res.json({ libraries });
});

module.exports = router;
