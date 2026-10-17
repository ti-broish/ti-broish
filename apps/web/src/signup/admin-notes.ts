/** Roster columns for volunteer notes and call requests (stored in payload / notes). */
export const NOTES_SQL = `,
  COALESCE(NULLIF(notes, ''), COALESCE(json_extract(payload, '$.notes'), '')) AS notes,
  COALESCE(json_extract(payload, '$.callRequestedAt'), '') AS call_requested_at,
  COALESCE(json_extract(payload, '$.callMessage'), '') AS call_message,
  COALESCE(json_extract(payload, '$.cantReachSection.section'), '') AS cant_reach_section,
  COALESCE(json_extract(payload, '$.cantReachSection.at'), '') AS cant_reach_at,
  COALESCE(staff_note, '') AS staff_note,
  COALESCE(staff_called_at, '') AS staff_called_at,
  COALESCE(staff_called_by, '') AS staff_called_by`

export interface NotesFields {
  notes: string
  callRequestedAt: string
  callMessage: string
  cantReachSection: string
  cantReachAt: string
  staffNote: string
  staffCalledAt: string
  staffCalledBy: string
}

export function notesFromRow(row: {
  notes?: string
  call_requested_at?: string
  call_message?: string
  cant_reach_section?: string
  cant_reach_at?: string
  staff_note?: string
  staff_called_at?: string
  staff_called_by?: string
}): NotesFields {
  return {
    notes: row.notes ?? '',
    callRequestedAt: row.call_requested_at ?? '',
    callMessage: row.call_message ?? '',
    cantReachSection: row.cant_reach_section ?? '',
    cantReachAt: row.cant_reach_at ?? '',
    staffNote: row.staff_note ?? '',
    staffCalledAt: row.staff_called_at ?? '',
    staffCalledBy: row.staff_called_by ?? '',
  }
}
