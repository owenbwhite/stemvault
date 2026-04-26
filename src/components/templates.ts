export interface TrackTemplate {
  name: string;
  type: 'AUDIO' | 'MIDI' | 'INSTRUMENT';
  stemCategory: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  genre: string;
  tracks: TrackTemplate[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'indie-rock',
    name: 'Indie Rock',
    description: 'Guitar-driven rock with full drum kit',
    genre: 'Indie Rock',
    tracks: [
      { name: 'Lead Vocals', type: 'AUDIO', stemCategory: 'Vocals' },
      { name: 'Backing Vocals', type: 'AUDIO', stemCategory: 'Vocals' },
      { name: 'Electric Guitar', type: 'AUDIO', stemCategory: 'Guitar' },
      { name: 'Rhythm Guitar', type: 'AUDIO', stemCategory: 'Guitar' },
      { name: 'Bass', type: 'AUDIO', stemCategory: 'Bass' },
      { name: 'Synth', type: 'AUDIO', stemCategory: 'Synth' },
      { name: 'Keys', type: 'AUDIO', stemCategory: 'Keys' },
      { name: 'Kick', type: 'AUDIO', stemCategory: 'Kick' },
      { name: 'Snare', type: 'AUDIO', stemCategory: 'Snare' },
      { name: 'Hi-Hats', type: 'AUDIO', stemCategory: 'Hi-Hat' },
      { name: 'Percs', type: 'AUDIO', stemCategory: 'Percussion' },
      { name: 'FX', type: 'AUDIO', stemCategory: 'FX' },
    ],
  },
  {
    id: 'hip-hop',
    name: 'Hip Hop',
    description: 'Beat production with vocals and 808s',
    genre: 'Hip Hop',
    tracks: [
      { name: 'Vocals', type: 'AUDIO', stemCategory: 'Vocals' },
      { name: 'Ad Libs', type: 'AUDIO', stemCategory: 'Vocals' },
      { name: 'Kick', type: 'AUDIO', stemCategory: 'Kick' },
      { name: 'Snare / Clap', type: 'AUDIO', stemCategory: 'Snare' },
      { name: 'Hi-Hats', type: 'AUDIO', stemCategory: 'Hi-Hat' },
      { name: 'Percs', type: 'AUDIO', stemCategory: 'Percussion' },
      { name: '808 Bass', type: 'AUDIO', stemCategory: 'Bass' },
      { name: 'Melody', type: 'AUDIO', stemCategory: 'Lead' },
      { name: 'Chords', type: 'AUDIO', stemCategory: 'Synth' },
      { name: 'Sample', type: 'AUDIO', stemCategory: 'Sample' },
      { name: 'FX', type: 'AUDIO', stemCategory: 'FX' },
    ],
  },
  {
    id: 'electronic',
    name: 'Electronic / EDM',
    description: 'Synthesizer-driven electronic music',
    genre: 'Electronic',
    tracks: [
      { name: 'Vocals', type: 'AUDIO', stemCategory: 'Vocals' },
      { name: 'Kick', type: 'AUDIO', stemCategory: 'Kick' },
      { name: 'Clap / Snare', type: 'AUDIO', stemCategory: 'Snare' },
      { name: 'Hi-Hats', type: 'AUDIO', stemCategory: 'Hi-Hat' },
      { name: 'Percs', type: 'AUDIO', stemCategory: 'Percussion' },
      { name: 'Sub Bass', type: 'AUDIO', stemCategory: 'Bass' },
      { name: 'Bass', type: 'AUDIO', stemCategory: 'Bass' },
      { name: 'Lead Synth', type: 'AUDIO', stemCategory: 'Lead' },
      { name: 'Pad', type: 'AUDIO', stemCategory: 'Pad' },
      { name: 'Pluck', type: 'AUDIO', stemCategory: 'Pluck' },
      { name: 'Arp', type: 'AUDIO', stemCategory: 'Arpeggiated' },
      { name: 'FX', type: 'AUDIO', stemCategory: 'FX' },
    ],
  },
  {
    id: 'pop',
    name: 'Pop',
    description: 'Modern pop production setup',
    genre: 'Pop',
    tracks: [
      { name: 'Lead Vocals', type: 'AUDIO', stemCategory: 'Vocals' },
      { name: 'Backing Vocals', type: 'AUDIO', stemCategory: 'Vocals' },
      { name: 'Kick', type: 'AUDIO', stemCategory: 'Kick' },
      { name: 'Snare', type: 'AUDIO', stemCategory: 'Snare' },
      { name: 'Hi-Hats', type: 'AUDIO', stemCategory: 'Hi-Hat' },
      { name: 'Bass', type: 'AUDIO', stemCategory: 'Bass' },
      { name: 'Guitar', type: 'AUDIO', stemCategory: 'Guitar' },
      { name: 'Piano / Keys', type: 'AUDIO', stemCategory: 'Keys' },
      { name: 'Synth Lead', type: 'AUDIO', stemCategory: 'Lead' },
      { name: 'Synth Pad', type: 'AUDIO', stemCategory: 'Pad' },
      { name: 'FX', type: 'AUDIO', stemCategory: 'FX' },
    ],
  },
  {
    id: 'jazz',
    name: 'Jazz / Neo-Soul',
    description: 'Live instrumentation with organic feel',
    genre: 'Jazz',
    tracks: [
      { name: 'Lead Vocals', type: 'AUDIO', stemCategory: 'Vocals' },
      { name: 'Backing Vocals', type: 'AUDIO', stemCategory: 'Vocals' },
      { name: 'Upright / Electric Bass', type: 'AUDIO', stemCategory: 'Bass' },
      { name: 'Piano', type: 'AUDIO', stemCategory: 'Keys' },
      { name: 'Rhodes', type: 'AUDIO', stemCategory: 'Keys' },
      { name: 'Guitar', type: 'AUDIO', stemCategory: 'Guitar' },
      { name: 'Trumpet', type: 'AUDIO', stemCategory: 'Brass' },
      { name: 'Saxophone', type: 'AUDIO', stemCategory: 'Woodwind' },
      { name: 'Kick', type: 'AUDIO', stemCategory: 'Kick' },
      { name: 'Snare', type: 'AUDIO', stemCategory: 'Snare' },
      { name: 'Hi-Hats', type: 'AUDIO', stemCategory: 'Hi-Hat' },
      { name: 'Cymbals', type: 'AUDIO', stemCategory: 'Percussion' },
    ],
  },
];
