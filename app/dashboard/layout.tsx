import { SidebarProvider } from "@/components/ui/sidebar";

export default async function DashboardLayout({
    children
}:{
    children:React.ReactNode
}){
    <SidebarProvider>
        <div className="flex min-h-screen w-full overflow-x-hidden">
            <main className="flex-1">
                {children}
            </main>
        </div>
    </SidebarProvider>
}