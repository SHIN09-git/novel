import { TASK_TEXT_FIELDS } from '../../shared/chapterTaskConstraints'

const string = { type: 'string', minLength: 1 }
export const chapterTaskProperties = {
  ...Object.fromEntries(TASK_TEXT_FIELDS.map(field => [field, { type: 'string' }])),
  povPolicy: {
    type: 'object', additionalProperties: false, required: ['mode', 'povCharacterId', 'perceptionChannels'],
    properties: { mode: { ...string, description: 'For example third_limited_single.' }, povCharacterId: string,
      perceptionChannels: { type: 'array', minItems: 1, items: string } }
  },
  storyTimeWindow: {
    type: 'object', additionalProperties: false, required: ['date', 'range'],
    properties: { date: { ...string, description: 'Gregorian YYYY-MM-DD.' }, weekday: { ...string, description: 'Optional Chinese weekday, e.g. 周五.' },
      range: { ...string, description: 'Same-day 24-hour time range, e.g. 20:57–20:59.' } }
  },
  mustOpenWithBeat: { ...string, description: 'Opening action to carry into the first 200 Chinese characters; for a continuation, bind it to the previous ending.' }
}
