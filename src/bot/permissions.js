const { PermissionFlagsBits } = require('discord.js');

/**
 * Un membre est considéré "staff" pour un ticket s'il a le rôle staff de la
 * catégorie du ticket, ou s'il a la permission ManageGuild (admin du serveur).
 */
function isStaffMember(member, staffRoleId) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;
  return false;
}

module.exports = { isStaffMember };
