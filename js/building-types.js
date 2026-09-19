// Toolbox — Building types + orientation helpers from field-reporter-pro.
// Adapted from public/survey.html BUILDING_TYPES / frontDoorToNorthRotation.
// Building type is survey-level in FRP (project.buildingType); Toolbox keeps
// the same ownership on record.distress.buildingType.

(function () {
  'use strict';

  const BUILDING_TYPES = {
    residential: {
      label: 'Residential',
      common: ['W.I.C', 'Kitchen', 'Primary Bedroom', 'Primary Bathroom', 'Bedroom', 'Bathroom', 'Living Room', 'Dining Room', 'Family Room', 'Garage', 'Laundry', 'Hallway', 'Closet', 'Foyer', 'Office'],
      specialty: ['Great Room', 'Breakfast Nook', 'Pantry', 'Butler\u2019s Pantry', 'Mud Room', 'Half Bath', 'Powder Room', 'Primary Closet', 'W.I.C', 'Den', 'Library', 'Study', 'Sunroom', 'Bonus Room', 'Game Room', 'Home Theater', 'Wine Cellar', 'Gym', 'Nursery', 'Guest Room', 'Basement', 'Attic', 'Crawl Space', 'Mechanical', 'Utility Room', 'Server Room', 'Workshop', 'Storage', 'Porch', 'Patio', 'Deck', 'Lanai', 'Pool House', 'Stairs'],
    },
    office: {
      label: 'Office',
      common: ['Reception', 'Waiting Area', 'Conference Room', 'Private Office', 'Open Office', 'Break Room', 'Restroom', 'Kitchen', 'Hallway', 'Storage'],
      specialty: ['Lobby', 'Boardroom', 'Huddle Room', 'Phone Booth', 'Copy Room', 'Mail Room', 'Server Room', 'IT Closet', 'Mechanical', 'Janitor', 'Lounge', 'Training Room', 'Library', 'Stairs'],
    },
    medical: {
      label: 'Medical Office',
      common: ['Reception', 'Waiting Room', 'Exam Room', 'Nurse Station', 'Doctor Office', 'Restroom', 'Lab', 'Hallway', 'Storage'],
      specialty: ['Triage', 'Procedure Room', 'X-Ray', 'Imaging', 'MRI', 'CT Scan', 'Ultrasound', 'Pharmacy', 'Sterilization', 'Recovery', 'Consult Room', 'Break Room', 'Mechanical', 'Janitor', 'Stairs'],
    },
    vet: {
      label: 'Vet Clinic',
      common: ['Reception', 'Waiting Area', 'Exam Room', 'Surgery', 'Kennel', 'Lab', 'Restroom', 'Storage', 'Hallway'],
      specialty: ['Triage', 'Grooming', 'Pharmacy', 'Recovery', 'Isolation', 'Radiology', 'X-Ray', 'Boarding', 'Food Storage', 'Break Room', 'Mechanical', 'Stairs'],
    },
    dental: {
      label: 'Dental',
      common: ['Reception', 'Waiting Room', 'Operatory', 'Sterilization', 'X-Ray', 'Restroom', 'Hallway', 'Storage'],
      specialty: ['Consult Room', 'Lab', 'Doctor Office', 'Break Room', 'Mechanical', 'Stairs'],
    },
    warehouse: {
      label: 'Warehouse',
      common: ['Receiving', 'Shipping', 'Loading Dock', 'Storage', 'Office', 'Restroom', 'Break Room'],
      specialty: ['Cold Storage', 'Freezer', 'Forklift Charging', 'Mechanical', 'Electrical Room', 'Server Room', 'Hallway', 'Stairs', 'Mezzanine'],
    },
  };

  const FRONT_DOOR_OPTIONS = [
    { value: '', label: '— not set —' },
    { value: 'N', label: 'North' },
    { value: 'NE', label: 'Northeast' },
    { value: 'E', label: 'East' },
    { value: 'SE', label: 'Southeast' },
    { value: 'S', label: 'South' },
    { value: 'SW', label: 'Southwest' },
    { value: 'W', label: 'West' },
    { value: 'NW', label: 'Northwest' },
  ];

  const BEARINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

  function frontDoorToNorthRotation(frontDoorFacing) {
    // Proven FRP rule: front of building drawn at bottom of plan.
    const beta = BEARINGS[frontDoorFacing];
    return beta == null ? 0 : ((180 - beta) % 360 + 360) % 360;
  }

  function getCommonRooms(type) {
    const t = type || 'residential';
    if (t === 'all') {
      const all = new Set();
      Object.keys(BUILDING_TYPES).forEach(function (k) {
        BUILDING_TYPES[k].common.forEach(function (n) { all.add(n); });
      });
      return Array.from(all);
    }
    return (BUILDING_TYPES[t] || BUILDING_TYPES.residential).common.slice();
  }

  function getSpecialtyRooms(type) {
    const t = type || 'residential';
    if (t === 'all') {
      const all = new Set();
      Object.keys(BUILDING_TYPES).forEach(function (k) {
        BUILDING_TYPES[k].specialty.forEach(function (n) { all.add(n); });
      });
      return Array.from(all);
    }
    return (BUILDING_TYPES[t] || BUILDING_TYPES.residential).specialty.slice();
  }

  function getAllPresetRooms(type) {
    return getCommonRooms(type).concat(getSpecialtyRooms(type));
  }

  function typeLabel(type) {
    if (type === 'all') return 'All / Mixed';
    return (BUILDING_TYPES[type] && BUILDING_TYPES[type].label) || type || 'Residential';
  }

  // Custom room presets scoped per building type (same localStorage keys as FRP).
  function legacyCustoms() {
    try { return JSON.parse(localStorage.getItem('customRoomPresets') || '[]'); } catch (e) { return []; }
  }

  function getCustomRooms(type) {
    const t = type || 'residential';
    let list = [];
    try { list = JSON.parse(localStorage.getItem('customRoomPresets:' + t) || '[]'); } catch (e) { list = []; }
    const legacy = legacyCustoms();
    if (legacy.length) {
      const seen = new Set(list.map(function (s) { return String(s).toLowerCase(); }));
      legacy.forEach(function (n) {
        if (!seen.has(String(n || '').toLowerCase())) {
          list.push(n);
          seen.add(String(n).toLowerCase());
        }
      });
    }
    return list;
  }

  function saveCustomRoom(name, type) {
    const n = (name || '').trim();
    if (!n) return;
    const t = type || 'residential';
    const presets = getAllPresetRooms(t).map(function (s) { return s.toLowerCase(); });
    if (presets.indexOf(n.toLowerCase()) !== -1) return;
    let list = [];
    try { list = JSON.parse(localStorage.getItem('customRoomPresets:' + t) || '[]'); } catch (e) { list = []; }
    if (list.map(function (s) { return s.toLowerCase(); }).indexOf(n.toLowerCase()) !== -1) return;
    list.push(n);
    localStorage.setItem('customRoomPresets:' + t, JSON.stringify(list));
  }

  function removeCustomRoom(name, type) {
    const t = type || 'residential';
    let list = [];
    try { list = JSON.parse(localStorage.getItem('customRoomPresets:' + t) || '[]'); } catch (e) { list = []; }
    list = list.filter(function (r) { return r.toLowerCase() !== String(name || '').toLowerCase(); });
    localStorage.setItem('customRoomPresets:' + t, JSON.stringify(list));
    const legacy = legacyCustoms().filter(function (r) {
      return r.toLowerCase() !== String(name || '').toLowerCase();
    });
    localStorage.setItem('customRoomPresets', JSON.stringify(legacy));
  }

  window.ToolboxBuildingTypes = {
    BUILDING_TYPES: BUILDING_TYPES,
    FRONT_DOOR_OPTIONS: FRONT_DOOR_OPTIONS,
    frontDoorToNorthRotation: frontDoorToNorthRotation,
    getCommonRooms: getCommonRooms,
    getSpecialtyRooms: getSpecialtyRooms,
    getAllPresetRooms: getAllPresetRooms,
    typeLabel: typeLabel,
    getCustomRooms: getCustomRooms,
    saveCustomRoom: saveCustomRoom,
    removeCustomRoom: removeCustomRoom,
  };
})();
