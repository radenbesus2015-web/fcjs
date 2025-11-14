# Admin Schedule Modal - Translation Keys

Modal pada halaman admin/schedule telah dibuat sepenuhnya kompatibel dengan fitur multilingual. Berikut adalah semua translation keys yang dibutuhkan:

## Translation Keys Required

### Override Modal - Scope Section
```json
{
  "adminSchedule.overrides.form.scope": "Applies to",
  "adminSchedule.overrides.scope.all": "Applies to everyone",
  "adminSchedule.overrides.scope.individual": "Specific people",
  "adminSchedule.overrides.form.scopeHelpAll": "Override applies to every member.",
  "adminSchedule.overrides.form.scopeHelpIndividual": "Select specific members that receive this override.",
  "adminSchedule.overrides.selectedMembers": "Selected members",
  "adminSchedule.overrides.editSelection": "Edit Selection",
  "adminSchedule.overrides.noMembersSelected": "No members selected",
  "adminSchedule.overrides.selectMembers": "Select Members"
}
```

### User Selection Modal - Header
```json
{
  "adminSchedule.userSelect.title": "Select Members",
  "adminSchedule.userSelect.subtitle": "Select members who will receive this custom schedule"
}
```

### User Selection Modal - Search Section
```json
{
  "adminSchedule.userSelect.searchPlaceholder": "Search member names...",
  "adminSchedule.userSelect.searchLabel": "Search members by name",
  "adminSchedule.userSelect.clearSearch": "Clear search"
}
```

### User Selection Modal - Action Buttons
```json
{
  "adminSchedule.userSelect.selectAll": "Select All",
  "adminSchedule.userSelect.selectAllTooltip": "Select all displayed members",
  "adminSchedule.userSelect.clearAll": "Clear All",
  "adminSchedule.userSelect.clearAllTooltip": "Clear all member selections"
}
```

### User Selection Modal - Status Messages
```json
{
  "adminSchedule.userSelect.selectedCount": "{count} members selected",
  "adminSchedule.userSelect.loading": "Loading member data...",
  "adminSchedule.userSelect.noResults": "No results found for this search",
  "adminSchedule.userSelect.noMembers": "No member data available"
}
```

### User Selection Modal - Member Information
```json
{
  "adminSchedule.userSelect.memberId": "ID",
  "adminSchedule.userSelect.selectMember": "Select member {name}"
}
```

### User Selection Modal - Footer Actions
```json
{
  "adminSchedule.userSelect.cancelAction": "Cancel member selection",
  "adminSchedule.userSelect.apply": "Apply ({count})",
  "adminSchedule.userSelect.applyAction": "Apply selection of {count} members"
}
```

### Toast Messages
```json
{
  "adminSchedule.userSelect.noSelection": "Please select at least one member",
  "adminSchedule.userSelect.applied": "{count} members selected for this override",
  "adminSchedule.error.fetchMembers": "Failed to load member data"
}
```

## English Translations Example

```json
{
  "adminSchedule.userSelect.title": "Select Members",
  "adminSchedule.userSelect.subtitle": "Select members who will receive this custom schedule",
  "adminSchedule.userSelect.searchPlaceholder": "Search member names...",
  "adminSchedule.userSelect.searchLabel": "Search members by name",
  "adminSchedule.userSelect.clearSearch": "Clear search",
  "adminSchedule.userSelect.selectAll": "Select All",
  "adminSchedule.userSelect.selectAllTooltip": "Select all displayed members",
  "adminSchedule.userSelect.clearAll": "Clear All",
  "adminSchedule.userSelect.clearAllTooltip": "Clear all member selections",
  "adminSchedule.userSelect.selectedCount": "{count} members selected",
  "adminSchedule.userSelect.loading": "Loading member data...",
  "adminSchedule.userSelect.noResults": "No results found for this search",
  "adminSchedule.userSelect.noMembers": "No member data available",
  "adminSchedule.userSelect.memberId": "ID",
  "adminSchedule.userSelect.selectMember": "Select member {name}",
  "adminSchedule.userSelect.cancelAction": "Cancel member selection",
  "adminSchedule.userSelect.apply": "Apply ({count})",
  "adminSchedule.userSelect.applyAction": "Apply selection of {count} members",
  "adminSchedule.userSelect.noSelection": "Please select at least one member",
  "adminSchedule.userSelect.applied": "{count} members selected for this override",
  "adminSchedule.error.fetchMembers": "Failed to load member data"
}
```

## Features Implemented

### ✅ Multilingual Support
- All text strings use `t()` function
- Proper parameter interpolation for dynamic content
- Fallback text provided for all translations

### ✅ Accessibility (ARIA)
- `aria-labelledby` and `aria-describedby` for modal
- `aria-label` for all interactive elements
- Proper `role` attributes
- Screen reader friendly

### ✅ Responsive Design
- Works on all screen sizes
- Touch-friendly interface
- Proper keyboard navigation

### ✅ User Experience
- Clear visual feedback
- Loading states
- Empty states
- Error handling
- Toast notifications

## Implementation Notes

1. **Parameter Interpolation**: Uses `{count}` and `{name}` parameters for dynamic content
2. **Fallback Values**: All `t()` calls include fallback text in Indonesian
3. **Consistent Naming**: Translation keys follow consistent pattern `adminSchedule.userSelect.*`
4. **Accessibility**: Full ARIA support for screen readers
5. **Error Handling**: Proper error messages for API failures

## Usage Example

```tsx
// In your component
const { t } = useI18n();

// Usage with parameters
{t("adminSchedule.userSelect.selectedCount", "{count} anggota dipilih", { count: selectedMembers.size })}

// Usage with complex parameters
{t("adminSchedule.userSelect.selectMember", "Pilih anggota {name}", { name: member.label })}
```
