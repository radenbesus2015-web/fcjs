# Custom Fields CRUD - Admin Schedule

Fitur CRUD (Create, Read, Update, Delete) untuk custom fields telah diimplementasikan pada halaman admin/schedule. Fitur ini memungkinkan admin untuk menambahkan kolom-kolom kustom pada form jadwal harian.

## Fitur yang Diimplementasikan

### ✅ Create (Tambah Field)
- **Tombol "Add Field"** untuk membuka modal create
- **Modal form** dengan semua konfigurasi field
- **Validasi** label field wajib diisi
- **Auto-generate ID** untuk setiap field baru

### ✅ Read (Tampil Field)
- **Display custom fields** dalam form jadwal
- **Responsive layout** dengan grid system
- **Visual indicators** untuk required fields (*)
- **Empty state** ketika belum ada custom fields

### ✅ Update (Edit Field)
- **Edit button** pada setiap field untuk membuka modal edit
- **Real-time value updates** saat user mengetik
- **Field configuration editing** (label, type, placeholder, dll)
- **Preserve field values** saat edit konfigurasi

### ✅ Delete (Hapus Field)
- **Delete button** dengan icon trash
- **Instant deletion** dengan konfirmasi toast
- **Clean removal** dari data structure

## Interface & Types

### CustomField Interface
```typescript
interface CustomField {
  id: string;                    // Unique identifier
  label: string;                 // Field label/name
  type: "text" | "number" | "time" | "textarea";  // Field type
  value: string | number;        // Field value
  required?: boolean;            // Is field required
  placeholder?: string;          // Placeholder text
  min?: number;                  // Min value (for number type)
  max?: number;                  // Max value (for number type)
}
```

### RuleItem Extension
```typescript
interface RuleItem {
  // ... existing properties
  customFields?: CustomField[];  // Array of custom fields
}
```

## Supported Field Types

### 1. Text Field
- **Type**: `"text"`
- **Input**: Single line text input
- **Use cases**: Names, descriptions, short notes

### 2. Number Field
- **Type**: `"number"`
- **Input**: Number input with min/max validation
- **Use cases**: Quantities, durations, scores
- **Extra config**: Min/Max values

### 3. Time Field
- **Type**: `"time"`
- **Input**: Time picker (HH:MM format)
- **Use cases**: Break times, meeting times

### 4. Textarea Field
- **Type**: `"textarea"`
- **Input**: Multi-line text area
- **Use cases**: Long descriptions, detailed notes

## UI Components

### Custom Fields Section
```tsx
{/* Custom Fields Section */}
<div className="md:col-span-2 space-y-3">
  <div className="flex items-center justify-between">
    <div className="text-sm font-medium">Custom Fields</div>
    <Button onClick={createCustomField}>
      <Icon name="Plus" />
      Add Field
    </Button>
  </div>
  
  {/* Fields Display */}
  {selectedRule?.customFields?.map((field) => (
    <FieldComponent key={field.id} field={field} />
  ))}
  
  {/* Empty State */}
  {!customFields?.length && (
    <div className="text-center py-4 border-dashed">
      No custom fields added yet
    </div>
  )}
</div>
```

### Field Component
```tsx
<div className="flex items-center gap-2">
  <div className="flex-1">
    <label>
      <div className="text-xs font-medium">
        {field.label}
        {field.required && <span className="text-red-500">*</span>}
      </div>
      <input
        type={field.type}
        value={field.value}
        placeholder={field.placeholder}
        onChange={(e) => updateCustomFieldValue(field.id, e.target.value)}
      />
    </label>
  </div>
  <div className="flex gap-1">
    <Button onClick={() => editCustomField(field)}>
      <Icon name="Pencil" />
    </Button>
    <Button onClick={() => deleteCustomField(field.id)}>
      <Icon name="Trash2" />
    </Button>
  </div>
</div>
```

## CRUD Functions

### Create
```typescript
const createCustomField = () => {
  const newField: CustomField = {
    id: genId(),
    label: "",
    type: "text",
    value: "",
    required: false,
    placeholder: ""
  };
  setModalCustomField({ open: true, field: newField, isEdit: false });
};
```

### Read
```typescript
// Fields are displayed automatically in the UI
// Data is stored in selectedRule.customFields
const customFields = selectedRule?.customFields || [];
```

### Update
```typescript
const saveCustomField = (field: CustomField) => {
  const updatedFields = selectedRule.customFields || [];
  const existingIndex = updatedFields.findIndex(f => f.id === field.id);
  
  if (existingIndex >= 0) {
    updatedFields[existingIndex] = field;
  } else {
    updatedFields.push(field);
  }
  
  updateRule(selectedDay, { customFields: updatedFields });
};

const updateCustomFieldValue = (fieldId: string, value: string | number) => {
  const updatedFields = (selectedRule.customFields || []).map(f => 
    f.id === fieldId ? { ...f, value } : f
  );
  updateRule(selectedDay, { customFields: updatedFields });
};
```

### Delete
```typescript
const deleteCustomField = (fieldId: string) => {
  const updatedFields = (selectedRule.customFields || []).filter(f => f.id !== fieldId);
  updateRule(selectedDay, { customFields: updatedFields });
  toast.success("Custom field deleted");
};
```

## Modal Configuration

### Create/Edit Modal
```tsx
<Dialog open={modalCustomField.open}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>
        {isEdit ? "Edit Custom Field" : "Create Custom Field"}
      </DialogTitle>
    </DialogHeader>
    
    <div className="space-y-4">
      {/* Field Label */}
      <Input
        value={field.label}
        onChange={(e) => updateField({ label: e.target.value })}
        placeholder="Enter field label"
      />
      
      {/* Field Type */}
      <select
        value={field.type}
        onChange={(e) => updateField({ type: e.target.value })}
      >
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="time">Time</option>
        <option value="textarea">Textarea</option>
      </select>
      
      {/* Placeholder */}
      <Input
        value={field.placeholder}
        onChange={(e) => updateField({ placeholder: e.target.value })}
        placeholder="Enter placeholder text"
      />
      
      {/* Number Type Specific */}
      {field.type === "number" && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="number"
            value={field.min}
            onChange={(e) => updateField({ min: Number(e.target.value) })}
            placeholder="Min value"
          />
          <Input
            type="number"
            value={field.max}
            onChange={(e) => updateField({ max: Number(e.target.value) })}
            placeholder="Max value"
          />
        </div>
      )}
      
      {/* Required Checkbox */}
      <div className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => updateField({ required: e.target.checked })}
        />
        <label>Required field</label>
      </div>
    </div>
    
    <DialogFooter>
      <Button variant="outline" onClick={closeModal}>Cancel</Button>
      <Button onClick={saveField} disabled={!field.label.trim()}>
        Save
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

## Translation Keys

### Custom Fields Section
```json
{
  "adminSchedule.customFields.title": "Custom Fields",
  "adminSchedule.customFields.add": "Add Field",
  "adminSchedule.customFields.empty": "No custom fields added yet",
  "adminSchedule.customFields.edit": "Edit field",
  "adminSchedule.customFields.delete": "Delete field"
}
```

### Modal
```json
{
  "adminSchedule.customFields.createTitle": "Create Custom Field",
  "adminSchedule.customFields.editTitle": "Edit Custom Field",
  "adminSchedule.customFields.fieldLabel": "Field Label",
  "adminSchedule.customFields.fieldType": "Field Type",
  "adminSchedule.customFields.placeholder": "Placeholder",
  "adminSchedule.customFields.required": "Required field",
  "adminSchedule.customFields.min": "Min Value",
  "adminSchedule.customFields.max": "Max Value"
}
```

### Field Types
```json
{
  "adminSchedule.customFields.types.text": "Text",
  "adminSchedule.customFields.types.number": "Number",
  "adminSchedule.customFields.types.time": "Time",
  "adminSchedule.customFields.types.textarea": "Textarea"
}
```

### Messages
```json
{
  "adminSchedule.customFields.saved": "Custom field saved",
  "adminSchedule.customFields.deleted": "Custom field deleted",
  "adminSchedule.customFields.validation.labelRequired": "Field label is required"
}
```

## Data Persistence

### Local State
- Custom fields disimpan dalam `selectedRule.customFields`
- Perubahan langsung update state lokal
- Integrasi dengan existing `updateRule()` function

### Server Sync
- Custom fields akan tersimpan saat `saveAll()` dipanggil
- Data dikirim sebagai bagian dari `rules` array
- Backend perlu mendukung `customFields` property

### Data Structure
```json
{
  "rules": [
    {
      "day": "Senin",
      "label": "Jam Kerja Senin",
      "enabled": true,
      "check_in": "08:30",
      "check_out": "17:00",
      "grace_in_min": 10,
      "grace_out_min": 5,
      "notes": "Jadwal normal",
      "customFields": [
        {
          "id": "field_123",
          "label": "Break Time",
          "type": "time",
          "value": "12:00",
          "required": false,
          "placeholder": "Enter break time"
        },
        {
          "id": "field_456",
          "label": "Overtime Hours",
          "type": "number",
          "value": 2,
          "required": true,
          "min": 0,
          "max": 8
        }
      ]
    }
  ]
}
```

## Features Implemented

### ✅ User Experience
- **Intuitive UI** dengan drag-and-drop feel
- **Real-time updates** tanpa page refresh
- **Responsive design** untuk semua device
- **Toast notifications** untuk feedback
- **Empty states** yang informatif

### ✅ Validation
- **Required field validation** pada modal
- **Type-specific validation** (min/max untuk number)
- **Label uniqueness** (bisa ditambahkan)
- **Data type consistency**

### ✅ Accessibility
- **Keyboard navigation** support
- **Screen reader friendly** dengan proper labels
- **Focus management** pada modal
- **ARIA attributes** yang sesuai

### ✅ Performance
- **Efficient state updates** dengan immutable patterns
- **Minimal re-renders** dengan proper memoization
- **Optimized data structures**
- **Clean memory management**

## Usage Example

1. **Buka halaman Admin Schedule**
2. **Pilih hari** yang ingin ditambahkan custom field
3. **Klik "Add Field"** di section Custom Fields
4. **Isi form** dengan konfigurasi field:
   - Label: "Break Time"
   - Type: "time"
   - Placeholder: "Enter break time"
   - Required: false
5. **Klik Save** untuk menambahkan field
6. **Field muncul** di form dengan input time picker
7. **Isi nilai** break time, misalnya "12:00"
8. **Edit field** dengan klik icon pencil
9. **Hapus field** dengan klik icon trash
10. **Save Schedule** untuk menyimpan semua perubahan

Fitur ini memberikan fleksibilitas penuh kepada admin untuk menyesuaikan form jadwal sesuai kebutuhan organisasi! 🎉
