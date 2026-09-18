const prisma = require('@library-tracker/db');

async function isHouseholdMember(householdId, userId) {
  const membership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  });
  return Boolean(membership);
}

module.exports = { isHouseholdMember };
