import {
  Users,
  FolderOpen,
  Settings,
  Activity,
  Shield,
  HelpCircle,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";

const menuItems = [
  { title: "الحسابات", icon: Users, active: true },
  { title: "الملفات", icon: FolderOpen },
  { title: "النشاط", icon: Activity },
  { title: "الحماية", icon: Shield },
  { title: "الإعدادات", icon: Settings },
];

export function AppSidebar() {
  return (
    <Sidebar className="border-l border-border" side="right">
      <SidebarHeader className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Users className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-bold text-foreground">TG Manager</h2>
            <p className="text-xs text-muted-foreground">v1.0.0</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>القائمة الرئيسية</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    className={item.active ? "bg-accent text-accent-foreground" : ""}
                  >
                    <item.icon className="w-4 h-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-border">
        <SidebarMenuButton className="w-full justify-start">
          <HelpCircle className="w-4 h-4" />
          <span>المساعدة</span>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
