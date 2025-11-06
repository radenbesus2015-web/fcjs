<script setup>
import { computed } from 'vue'
import { getLucideComponent } from '@/utils/icons'

const props = defineProps({
  name: { type: String, required: true },
  class: { type: String, default: '' },
})

const Comp = computed(() => getLucideComponent(props.name))
</script>

<template>
  <component v-if="Comp" :is="Comp" :class="props.class" />
</template>

