export const ASSIGNMENT_ERRORS: Record<string, string> = {
  CHORE_NOT_FOUND:        'המשימה לא נמצאה',
  ALREADY_ASSIGNED:       'כבר שויכת למשימה זו בחריץ זה',
  NOT_IN_FAMILY:          'אין הרשאה לגשת למשימה זו',
  CHORE_TAKEN:            'המשימה כבר נלקחה על ידי שחקן אחר',
  INVALID_INPUT:          'קלט לא תקין — אנא נסה שנית',
  INVALID_CALENDAR_DAY:   'יום לא תקין',
  INVALID_CALENDAR_SLOT:  'חריץ זמן לא תקין',
  TOO_MANY_ASSIGNEES:     'ניתן לשייך רק שחקן אחד למשימה שאינה חוזרת',
  FORBIDDEN_FIELD_UPDATE: 'פעולה זו אינה מורשית',
  INTERNAL_ERROR:         'שגיאה פנימית — אנא נסה שנית מאוחר יותר',
}

export function assignmentErrorMessage(code: string): string {
  return ASSIGNMENT_ERRORS[code] ?? ASSIGNMENT_ERRORS.INTERNAL_ERROR
}
