/**
 * Avatar registry. Every skin item id maps to an image under /avatars/.
 *
 * ADDING YOUR OWN AVATARS:
 * 1. Drop any image (svg/png/jpg, square works best) into public/avatars/
 * 2. Add a line here: my_hero: { src: '/avatars/my_hero.png', name: 'My Hero' }
 * 3. (optional) Make it earnable/buyable: add a matching skin ItemDef with the
 *    same id in backend/app/market/catalog.py, and/or price it on the Shop
 *    contract for BOT purchases. Without a catalog entry it's a free default.
 */

export interface AvatarDef {
  src: string;
  name: string;
}

export const AVATARS: Record<string, AvatarDef> = {
  // ── Original 10 ──────────────────────────────────────────────────────────
  av_ronin:    { src: '/avatars/av_ronin.svg',    name: 'Ronin' },
  av_guardian: { src: '/avatars/av_guardian.svg', name: 'Guardian' },
  av_striker:  { src: '/avatars/av_striker.svg',  name: 'Striker' },
  av_mystic:   { src: '/avatars/av_mystic.svg',   name: 'Mystic' },
  av_captain:  { src: '/avatars/av_captain.svg',  name: 'Captain' },
  av_shadow:   { src: '/avatars/av_shadow.svg',   name: 'Shadow' },
  av_valkyrie: { src: '/avatars/av_valkyrie.svg', name: 'Valkyrie' },
  av_monk:     { src: '/avatars/av_monk.svg',     name: 'Monk' },
  av_cyber:    { src: '/avatars/av_cyber.svg',    name: 'Cyber Duelist' },
  av_champion: { src: '/avatars/av_champion.svg', name: 'Champion' },

  // ── New additions ─────────────────────────────────────────────────────────
  // Phantom   – purple void ghost; aggressive playstyle flavour
  av_phantom:   { src: '/avatars/av_phantom.svg',   name: 'Phantom' },
  
  // Berserker – blazing orange rage fighter; pairs well with high-ATK agents
  av_berserker: { src: '/avatars/av_berserker.svg', name: 'Berserker' },
  // Warlord   – gold-trimmed armored commander; prestige / tournament feel
  av_warlord:   { src: '/avatars/av_warlord.svg',   name: 'Warlord' },
  // Specter   – neon-green matrix hacker; high-INT / Tactical personality
  av_specter:   { src: '/avatars/av_specter.svg',   name: 'Specter' },
  // Tempest   – cyan lightning elemental; speed-focused aesthetic
  av_tempest:   { src: '/avatars/av_tempest.svg',   name: 'Tempest' },
  // Ironclad  – silver/gunmetal tank; DEF-heavy / Defensive personality
  av_ironclad:  { src: '/avatars/av_ironclad.svg',  name: 'Ironclad' },
  // Oracle    – purple psychic seer; INT-heavy / Tactical personality
  av_oracle:    { src: '/avatars/av_oracle.svg',    name: 'Oracle' },
 av_ranger_red:  { src: '/avatars/av_ranger_red.svg',  name: 'Red Ranger' },
  // Blue Ranger  – cool blue/white sentai; tactical support feel
  av_ranger_blue: { src: '/avatars/av_ranger_blue.svg', name: 'Blue Ranger' },
  // Gold Ranger  – elite gold/black sentai; prestige / tournament variant
  av_ranger_gold: { src: '/avatars/av_ranger_gold.svg', name: 'Gold Ranger' },

  // ── Superhero pack ───────────────────────────────────────────────────────
  // Blaze  – red/orange flame hero; high-ATK aggressive playstyle
  av_blaze:  { src: '/avatars/av_blaze.svg',  name: 'Blaze' },
  // Nova   – cosmic purple/pink; INT-heavy / Tactical personality
  av_nova:   { src: '/avatars/av_nova.svg',   name: 'Nova' },
  // Volt   – blue/yellow electric hero; speed-focused aesthetic
  av_volt:   { src: '/avatars/av_volt.svg',   name: 'Volt' },
  // Titan  – green hulk-type; DEF-heavy / tank personality
  av_titan:  { src: '/avatars/av_titan.svg',  name: 'Titan' },
};
