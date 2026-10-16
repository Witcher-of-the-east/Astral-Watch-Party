'use strict';
/**
 * Catalogue. Videos are open-licensed (Blender Foundation, CC-BY) or Google's public sample
 * bucket, so they play for everybody. Poster/backdrop artwork is generated in the browser
 * (public/js/art.js) from the `theme` below, so no copyrighted images are shipped.
 *
 * Add your own: push another object here. `source.kind` is 'file' (direct mp4/webm URL)
 * or 'youtube' (give `ytId`).
 */
const G = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/';

const movies = [
  {
    id: 'big-buck-bunny',
    title: 'Big Buck Bunny',
    year: 2008, rating: 4.2, runtime: 10,
    genres: ['Animation', 'Comedy', 'Family'],
    format: 'HD', age: 'PG', country: 'Netherlands', language: 'No dialogue', director: 'Sacha Goedegebure',
    tagline: 'A gentle giant. Three bullies. One very bad idea.',
    description: 'A large and lovable rabbit loses his patience with three tiny rodents who treat the forest like their playground. Pure slapstick revenge, drawn like a painting.',
    cast: [
      { name: 'Big Buck', role: 'The bunny' }, { name: 'Frank', role: 'Flying squirrel' },
      { name: 'Rinky', role: 'Squirrel' }, { name: 'Gimera', role: 'Chinchilla' }
    ],
    times: ['17:30', '19:45', '22:00'],
    theme: { h1: 130, h2: 52, motif: 'meadow' },
    source: { kind: 'file', url: G + 'BigBuckBunny.mp4' }
  },
  {
    id: 'sintel',
    title: 'Sintel',
    year: 2010, rating: 4.4, runtime: 15,
    genres: ['Fantasy', 'Animation', 'Adventure'],
    format: 'IMAX 3D', age: 'PG-13', country: 'Netherlands', language: 'English', director: 'Colin Levy',
    tagline: 'Some journeys end where they began.',
    description: 'A lone young woman searches a brutal frozen world for the small dragon she once befriended. A short fantasy about loss, and what you are willing to cross for it.',
    cast: [
      { name: 'Sintel', role: 'The wanderer' }, { name: 'Scales', role: 'The dragon' },
      { name: 'Shaman', role: 'The guide' }, { name: 'Hunter', role: 'The rival' }
    ],
    times: ['18:10', '20:30', '23:15'],
    theme: { h1: 212, h2: 188, motif: 'peaks' },
    source: { kind: 'file', url: G + 'Sintel.mp4' }
  },
  {
    id: 'tears-of-steel',
    title: 'Tears of Steel',
    year: 2012, rating: 3.9, runtime: 12,
    genres: ['Sci-Fi', 'Action', 'Drama'],
    format: 'IMAX 3D', age: 'PG-13', country: 'Netherlands', language: 'English', director: 'Ian Hubert',
    tagline: 'The future is rebuilding itself, one memory at a time.',
    description: 'In an Amsterdam overrun by machines, a band of warriors and scientists try to save the world by going back to the moment everything broke.',
    cast: [
      { name: 'Thom', role: 'The soldier' }, { name: 'Celia', role: 'The scientist' },
      { name: 'Barley', role: 'The engineer' }, { name: 'Rob', role: 'The captain' }
    ],
    times: ['16:45', '19:20', '22:40'],
    theme: { h1: 22, h2: 188, motif: 'city' },
    source: { kind: 'file', url: G + 'TearsOfSteel.mp4' }
  },
  {
    id: 'elephants-dream',
    title: 'Elephants Dream',
    year: 2006, rating: 3.6, runtime: 11,
    genres: ['Surreal', 'Animation', 'Sci-Fi'],
    format: 'HD', age: 'PG', country: 'Netherlands', language: 'English', director: 'Bassam Kurdali',
    tagline: 'Reality is a matter of who is holding the map.',
    description: 'Two strangers wander through an enormous, shifting machine of a building. One of them insists it is all real. The other is not so sure.',
    cast: [{ name: 'Proog', role: 'The guide' }, { name: 'Emo', role: 'The sceptic' }],
    times: ['17:00', '20:00', '22:30'],
    theme: { h1: 285, h2: 24, motif: 'arches' },
    source: { kind: 'file', url: G + 'ElephantsDream.mp4' }
  },
  {
    id: 'for-bigger-blazes',
    title: 'Bigger Blazes',
    year: 2013, rating: 3.4, runtime: 1,
    genres: ['Action', 'Short'],
    format: 'HD', age: 'G', country: 'Global', language: 'None', director: 'Sample reel',
    tagline: 'Fifteen seconds. All fire.',
    description: 'A fifteen-second burst of colour and motion. Perfect for testing how tightly your party stays in sync.',
    cast: [{ name: 'The Flame', role: 'Lead' }, { name: 'Smoke', role: 'Support' }],
    times: ['18:00', '21:00', '23:30'],
    theme: { h1: 12, h2: 44, motif: 'rays' },
    source: { kind: 'file', url: G + 'ForBiggerBlazes.mp4' }
  },
  {
    id: 'for-bigger-joyrides',
    title: 'Bigger Joyrides',
    year: 2013, rating: 3.5, runtime: 1,
    genres: ['Adventure', 'Short'],
    format: 'HD', age: 'G', country: 'Global', language: 'None', director: 'Sample reel',
    tagline: 'Windows down. Horizon up.',
    description: 'Another short and sweet reel: an open road, fast cars and a very long horizon.',
    cast: [{ name: 'The Driver', role: 'Lead' }, { name: 'The Road', role: 'Co-star' }],
    times: ['17:15', '20:15', '23:00'],
    theme: { h1: 340, h2: 36, motif: 'road' },
    source: { kind: 'file', url: G + 'ForBiggerJoyrides.mp4' }
  },
  {
    id: 'signal-test-reel',
    title: 'Signal: Test Reel',
    year: 2026, rating: 4.8, runtime: 2,
    genres: ['Demo', 'Short', 'Sci-Fi'],
    format: 'Local', age: 'G', country: 'Your machine', language: 'Beeps', director: 'Astral',
    tagline: 'Plays offline. Shows a live timer so you can eyeball sync.',
    description: 'Bundled with this project and served from your own computer, so it works without internet. The on-screen timer makes it easy to compare two browser windows side by side.',
    cast: [{ name: 'Test Card', role: 'Lead' }, { name: 'Sine Wave', role: 'Score' }],
    times: ['17:30', '18:40', '23:00'],
    theme: { h1: 48, h2: 200, motif: 'signal' },
    source: { kind: 'file', url: '/media/demo.mp4', alt: '/media/demo.webm' }
  }
];

module.exports = { movies, findMovie: (id) => movies.find((m) => m.id === id) };
