
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_logs": {
                  Row: {
                    "action": Database["public"]['Enums']["audit_action"],"admin_id": string | null,"changes": Json | null,"created_at": string,"entity_id": string | null,"entity_type": string,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": Database["public"]['Enums']["audit_action"],"admin_id"?: string | null,"changes"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: never
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["audit_action"],"admin_id"?: string | null,"changes"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: never
                  }
                  Relationships: [
                    
                  ]
                },"fare_rules": {
                  Row: {
                    "amount": number,"created_at": string,"currency": string,"effective_from": string,"effective_until": string | null,"from_stop_id": string | null,"id": string,"passenger_type": Database["public"]['Enums']["passenger_type"],"route_id": string,"source_description": string | null,"to_stop_id": string | null,"updated_at": string,"verification_status": Database["public"]['Enums']["verification_status"],"verified_at": string | null,"import_batch_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"currency"?: string,"effective_from": string,"effective_until"?: string | null,"from_stop_id"?: string | null,"id"?: string,"passenger_type"?: Database["public"]['Enums']["passenger_type"],"route_id": string,"source_description"?: string | null,"to_stop_id"?: string | null,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"],"verified_at"?: string | null,"import_batch_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"currency"?: string,"effective_from"?: string,"effective_until"?: string | null,"from_stop_id"?: string | null,"id"?: string,"passenger_type"?: Database["public"]['Enums']["passenger_type"],"route_id"?: string,"source_description"?: string | null,"to_stop_id"?: string | null,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"],"verified_at"?: string | null,"import_batch_id"?: string | null
                  }
                  Relationships: [
    {
      foreignKeyName: "fare_rules_import_batch_id_fkey"
      columns: ["import_batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["id"]
    },
                    {
      foreignKeyName: "fare_rules_from_stop_id_fkey"
      columns: ["from_stop_id"]
isOneToOne: false
      referencedRelation: "stops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fare_rules_route_id_fkey"
      columns: ["route_id"]
isOneToOne: false
      referencedRelation: "routes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fare_rules_to_stop_id_fkey"
      columns: ["to_stop_id"]
isOneToOne: false
      referencedRelation: "stops"
      referencedColumns: ["id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "counts": Json,"created_at": string,"files": Json,"id": string,"imported_by": string | null,"notes": string | null,"source_description": string
                  }
                  ComputedFields: never
                  Insert: {
                    "counts"?: Json,"created_at"?: string,"files"?: Json,"id"?: string,"imported_by"?: string | null,"notes"?: string | null,"source_description": string
                  }
                  Update: {
                    "counts"?: Json,"created_at"?: string,"files"?: Json,"id"?: string,"imported_by"?: string | null,"notes"?: string | null,"source_description"?: string
                  }
                  Relationships: []
                },"route_verifications": {
                  Row: {
                    "boarding_dropoff_ok": boolean,"created_at": string,"endpoints_ok": boolean,"fares_ok": boolean,"geometry_ok": boolean,"id": string,"name_direction_ok": boolean,"notes": string | null,"passenger_categories_ok": boolean,"route_id": string,"source_description": string,"stops_ok": boolean,"transport_type_ok": boolean,"verified_by": string | null,"verified_on": string
                  }
                  ComputedFields: never
                  Insert: {
                    "boarding_dropoff_ok": boolean,"created_at"?: string,"endpoints_ok": boolean,"fares_ok": boolean,"geometry_ok": boolean,"id"?: string,"name_direction_ok": boolean,"notes"?: string | null,"passenger_categories_ok": boolean,"route_id": string,"source_description": string,"stops_ok": boolean,"transport_type_ok": boolean,"verified_by"?: string | null,"verified_on": string
                  }
                  Update: {
                    "boarding_dropoff_ok"?: boolean,"created_at"?: string,"endpoints_ok"?: boolean,"fares_ok"?: boolean,"geometry_ok"?: boolean,"id"?: string,"name_direction_ok"?: boolean,"notes"?: string | null,"passenger_categories_ok"?: boolean,"route_id"?: string,"source_description"?: string,"stops_ok"?: boolean,"transport_type_ok"?: boolean,"verified_by"?: string | null,"verified_on"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "route_verifications_route_id_fkey"
      columns: ["route_id"]
isOneToOne: false
      referencedRelation: "routes"
      referencedColumns: ["id"]
    }
                  ]
                },"landmarks": {
                  Row: {
                    "barangay": string | null,"category": string,"created_at": string,"id": string,"latitude": number,"longitude": number,"name": string,"updated_at": string,"verification_status": Database["public"]['Enums']["verification_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "barangay"?: string | null,"category": string,"created_at"?: string,"id"?: string,"latitude": number,"longitude": number,"name": string,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"]
                  }
                  Update: {
                    "barangay"?: string | null,"category"?: string,"created_at"?: string,"id"?: string,"latitude"?: number,"longitude"?: number,"name"?: string,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"]
                  }
                  Relationships: [
                    
                  ]
                },"route_reports": {
                  Row: {
                    "created_at": string,"description": string,"id": string,"report_type": Database["public"]['Enums']["report_type"],"reporter_contact": string | null,"route_id": string | null,"status": Database["public"]['Enums']["report_status"],"stop_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description": string,"id"?: string,"report_type": Database["public"]['Enums']["report_type"],"reporter_contact"?: string | null,"route_id"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"stop_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: string,"report_type"?: Database["public"]['Enums']["report_type"],"reporter_contact"?: string | null,"route_id"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"stop_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "route_reports_route_id_fkey"
      columns: ["route_id"]
isOneToOne: false
      referencedRelation: "routes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "route_reports_stop_id_fkey"
      columns: ["stop_id"]
isOneToOne: false
      referencedRelation: "stops"
      referencedColumns: ["id"]
    }
                  ]
                },"route_shapes": {
                  Row: {
                    "created_at": string,"direction": Database["public"]['Enums']["route_direction"],"geometry": unknown,"id": string,"last_verified_at": string | null,"route_id": string,"source": string | null,"updated_at": string,"verification_status": Database["public"]['Enums']["verification_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"direction"?: Database["public"]['Enums']["route_direction"],"geometry": unknown,"id"?: string,"last_verified_at"?: string | null,"route_id": string,"source"?: string | null,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"]
                  }
                  Update: {
                    "created_at"?: string,"direction"?: Database["public"]['Enums']["route_direction"],"geometry"?: unknown,"id"?: string,"last_verified_at"?: string | null,"route_id"?: string,"source"?: string | null,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "route_shapes_route_id_fkey"
      columns: ["route_id"]
isOneToOne: false
      referencedRelation: "routes"
      referencedColumns: ["id"]
    }
                  ]
                },"route_stops": {
                  Row: {
                    "boarding_allowed": boolean | null,"created_at": string,"direction": Database["public"]['Enums']["route_direction"],"dropoff_allowed": boolean | null,"id": string,"route_id": string,"stop_id": string,"stop_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "boarding_allowed"?: boolean | null,"created_at"?: string,"direction"?: Database["public"]['Enums']["route_direction"],"dropoff_allowed"?: boolean | null,"id"?: string,"route_id": string,"stop_id": string,"stop_order": number
                  }
                  Update: {
                    "boarding_allowed"?: boolean | null,"created_at"?: string,"direction"?: Database["public"]['Enums']["route_direction"],"dropoff_allowed"?: boolean | null,"id"?: string,"route_id"?: string,"stop_id"?: string,"stop_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "route_stops_route_id_fkey"
      columns: ["route_id"]
isOneToOne: false
      referencedRelation: "routes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "route_stops_stop_id_fkey"
      columns: ["stop_id"]
isOneToOne: false
      referencedRelation: "stops"
      referencedColumns: ["id"]
    }
                  ]
                },"routes": {
                  Row: {
                    "code": string | null,"created_at": string,"description": string | null,"destination_label": string | null,"id": string,"last_verified_at": string | null,"name": string,"origin_label": string | null,"status": Database["public"]['Enums']["route_status"],"transport_type": Database["public"]['Enums']["transport_type"],"updated_at": string,"verification_status": Database["public"]['Enums']["verification_status"],"import_batch_id": string | null,"is_sample": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "code"?: string | null,"created_at"?: string,"description"?: string | null,"destination_label"?: string | null,"id"?: string,"last_verified_at"?: string | null,"name": string,"origin_label"?: string | null,"status"?: Database["public"]['Enums']["route_status"],"transport_type": Database["public"]['Enums']["transport_type"],"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"],"import_batch_id"?: string | null,"is_sample"?: boolean
                  }
                  Update: {
                    "code"?: string | null,"created_at"?: string,"description"?: string | null,"destination_label"?: string | null,"id"?: string,"last_verified_at"?: string | null,"name"?: string,"origin_label"?: string | null,"status"?: Database["public"]['Enums']["route_status"],"transport_type"?: Database["public"]['Enums']["transport_type"],"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"],"import_batch_id"?: string | null,"is_sample"?: boolean
                  }
                  Relationships: [
    {
      foreignKeyName: "routes_import_batch_id_fkey"
      columns: ["import_batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["id"]
    }
                    
                  ]
                },"stops": {
                  Row: {
                    "barangay": string | null,"created_at": string,"dropoff_allowed": boolean,"id": string,"landmark_description": string | null,"last_verified_at": string | null,"latitude": number,"longitude": number,"name": string,"pickup_allowed": boolean,"updated_at": string,"verification_status": Database["public"]['Enums']["verification_status"],"import_batch_id": string | null,"is_sample": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "barangay"?: string | null,"created_at"?: string,"dropoff_allowed"?: boolean,"id"?: string,"landmark_description"?: string | null,"last_verified_at"?: string | null,"latitude": number,"longitude": number,"name": string,"pickup_allowed"?: boolean,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"],"import_batch_id"?: string | null,"is_sample"?: boolean
                  }
                  Update: {
                    "barangay"?: string | null,"created_at"?: string,"dropoff_allowed"?: boolean,"id"?: string,"landmark_description"?: string | null,"last_verified_at"?: string | null,"latitude"?: number,"longitude"?: number,"name"?: string,"pickup_allowed"?: boolean,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"],"import_batch_id"?: string | null,"is_sample"?: boolean
                  }
                  Relationships: [
    {
      foreignKeyName: "stops_import_batch_id_fkey"
      columns: ["import_batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["id"]
    }
                    
                  ]
                }
          }
          Views: {
            "route_shapes_geojson": {
                  Row: {
                    "direction": Database["public"]['Enums']["route_direction"] | null,"geojson": Json | null,"id": string | null,"last_verified_at": string | null,"route_id": string | null,"source": string | null,"verification_status": Database["public"]['Enums']["verification_status"] | null
                  }
                  ComputedFields: never
                  Insert: {
                           "direction"?: Database["public"]['Enums']["route_direction"] | null,"geojson"?: never,"id"?: string | null,"last_verified_at"?: string | null,"route_id"?: string | null,"source"?: string | null,"verification_status"?: Database["public"]['Enums']["verification_status"] | null
                         }
                        Update: {
                           "direction"?: Database["public"]['Enums']["route_direction"] | null,"geojson"?: never,"id"?: string | null,"last_verified_at"?: string | null,"route_id"?: string | null,"source"?: string | null,"verification_status"?: Database["public"]['Enums']["verification_status"] | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "route_shapes_route_id_fkey"
      columns: ["route_id"]
isOneToOne: false
      referencedRelation: "routes"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            commit_import: { Args: { p_payload: Json }; Returns: Json }
            is_current_user_admin: { Args: never; Returns: boolean }
            save_route: { Args: { p_data: Json; p_route_id: string }; Returns: string }
            verify_route: {
              Args: { p_checks: Json; p_notes?: string; p_route_id: string; p_source: string; p_verified_on: string }
              Returns: string
            }
          }
          Enums: {
            "audit_action": "insert"|"update"|"delete","passenger_type": "regular"|"student"|"senior"|"pwd","report_status": "new"|"reviewing"|"resolved"|"rejected","report_type": "incorrect_route"|"incorrect_stop"|"incorrect_fare"|"missing_route"|"missing_stop"|"other","route_direction": "outbound"|"inbound","route_status": "draft"|"active"|"inactive","transport_type": "jeepney"|"multicab","verification_status": "unverified"|"verified"|"outdated"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "audit_action": ["insert", "update", "delete"],"passenger_type": ["regular", "student", "senior", "pwd"],"report_status": ["new", "reviewing", "resolved", "rejected"],"report_type": ["incorrect_route", "incorrect_stop", "incorrect_fare", "missing_route", "missing_stop", "other"],"route_direction": ["outbound", "inbound"],"route_status": ["draft", "active", "inactive"],"transport_type": ["jeepney", "multicab"],"verification_status": ["unverified", "verified", "outdated"]
          }
        }
} as const
