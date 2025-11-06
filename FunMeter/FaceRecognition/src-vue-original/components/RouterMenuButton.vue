<script setup lang="ts">
import { RouterLink } from "vue-router"
import { SidebarMenuButton } from "@/components/ui/sidebar"

const props = withDefaults(defineProps<{
  to: string | Record<string, any>
  tooltip?: string
  exact?: boolean
}>(), {
  exact: true,
})
</script>

<template>
  <RouterLink :to="props.to" custom v-slot="{ href, navigate, isActive, isExactActive }">
    <SidebarMenuButton as-child :is-active="props.exact ? isExactActive : isActive" :tooltip="props.tooltip">
      <a :href="href" @click="navigate" :aria-current="(props.exact ? isExactActive : isActive) ? ('page' as const) : undefined">
        <slot />
      </a>
    </SidebarMenuButton>
  </RouterLink>
  
</template>

