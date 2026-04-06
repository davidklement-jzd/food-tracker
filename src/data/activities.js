const ACTIVITIES_DB = [
  { id: 'walking', name: 'Chůze', kcal_per_hour: 250 },
  { id: 'brisk_walking', name: 'Rychlá chůze', kcal_per_hour: 350 },
  { id: 'running_slow', name: 'Běh (pomalý)', kcal_per_hour: 500 },
  { id: 'running', name: 'Běh', kcal_per_hour: 600 },
  { id: 'running_fast', name: 'Běh (rychlý)', kcal_per_hour: 800 },
  { id: 'cycling', name: 'Jízda na kole', kcal_per_hour: 450 },
  { id: 'cycling_intense', name: 'Jízda na kole (intenzivní)', kcal_per_hour: 700 },
  { id: 'swimming', name: 'Plavání', kcal_per_hour: 500 },
  { id: 'swimming_intense', name: 'Plavání (intenzivní)', kcal_per_hour: 700 },
  { id: 'strength', name: 'Posilování', kcal_per_hour: 400 },
  { id: 'crossfit', name: 'CrossFit', kcal_per_hour: 600 },
  { id: 'hiit', name: 'HIIT', kcal_per_hour: 700 },
  { id: 'yoga', name: 'Jóga', kcal_per_hour: 200 },
  { id: 'pilates', name: 'Pilates', kcal_per_hour: 250 },
  { id: 'stretching', name: 'Strečink', kcal_per_hour: 150 },
  { id: 'dance', name: 'Tanec', kcal_per_hour: 400 },
  { id: 'aerobics', name: 'Aerobik', kcal_per_hour: 450 },
  { id: 'rowing', name: 'Veslování', kcal_per_hour: 500 },
  { id: 'jump_rope', name: 'Švihadlo', kcal_per_hour: 700 },
  { id: 'boxing', name: 'Box / kickbox', kcal_per_hour: 600 },
  { id: 'tennis', name: 'Tenis', kcal_per_hour: 450 },
  { id: 'badminton', name: 'Badminton', kcal_per_hour: 350 },
  { id: 'football', name: 'Fotbal', kcal_per_hour: 500 },
  { id: 'basketball', name: 'Basketbal', kcal_per_hour: 500 },
  { id: 'volleyball', name: 'Volejbal', kcal_per_hour: 350 },
  { id: 'hiking', name: 'Turistika', kcal_per_hour: 400 },
  { id: 'skiing', name: 'Lyžování', kcal_per_hour: 450 },
  { id: 'skating', name: 'Bruslení', kcal_per_hour: 400 },
  { id: 'elliptical', name: 'Eliptický trenažér', kcal_per_hour: 450 },
  { id: 'stairmaster', name: 'Stepper / schody', kcal_per_hour: 500 },
  { id: 'housework', name: 'Domácí práce', kcal_per_hour: 200 },
  { id: 'gardening', name: 'Zahradničení', kcal_per_hour: 300 },
];

export function searchActivities(query) {
  const q = query.toLowerCase().trim();
  if (!q) return ACTIVITIES_DB;
  return ACTIVITIES_DB.filter((a) => a.name.toLowerCase().includes(q));
}

export default ACTIVITIES_DB;
