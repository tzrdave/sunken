import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";

/**
 * Custom hook for managing DKP state with normalized Supabase tables
 * Tables: raiders, raid_history, loot_history, scheduled_raids
 */
export function useSupabaseState() {
  const [raiders, setRaiders] = useState([]);
  const [raidHistory, setRaidHistory] = useState([]);
  const [lootHistory, setLootHistory] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Track if we're currently saving to prevent realtime echo
  const saving = useRef(false);

  // ============================================================================
  // INITIAL DATA LOAD
  // ============================================================================
  useEffect(() => {
    let active = true;

    const loadAllData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Load all tables in parallel
        const [raidersRes, raidHistoryRes, lootHistoryRes, scheduledRes] = await Promise.all([
          supabase.from("raiders").select("*").order("dkp", { ascending: false }),
          supabase.from("raid_history").select("*").order("completed_at", { ascending: false }),
          supabase.from("loot_history").select("*").order("timestamp", { ascending: false }),
          supabase.from("scheduled_raids").select("*").order("date_time", { ascending: true }),
        ]);

        if (!active) return;

        // Check for errors
        if (raidersRes.error) throw raidersRes.error;
        if (raidHistoryRes.error) throw raidHistoryRes.error;
        if (lootHistoryRes.error) throw lootHistoryRes.error;
        if (scheduledRes.error) throw scheduledRes.error;

        // Transform data from snake_case to camelCase for app compatibility
        setRaiders((raidersRes.data || []).map(transformRaiderFromDb));
        setRaidHistory((raidHistoryRes.data || []).map(transformRaidFromDb));
        setLootHistory((lootHistoryRes.data || []).map(transformLootFromDb));
        setScheduled((scheduledRes.data || []).map(transformScheduledFromDb));
        
        setLoading(false);
      } catch (err) {
        if (!active) return;
        setError(err.message ?? String(err));
        setLoading(false);
      }
    };

    loadAllData();

    return () => {
      active = false;
    };
  }, []);

  // ============================================================================
  // REALTIME SUBSCRIPTIONS
  // ============================================================================
  useEffect(() => {
    const channel = supabase
      .channel("dkp_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "raiders" },
        (payload) => {
          if (saving.current) return;
          handleRealtimeChange("raiders", payload);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "raid_history" },
        (payload) => {
          if (saving.current) return;
          handleRealtimeChange("raidHistory", payload);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "loot_history" },
        (payload) => {
          if (saving.current) return;
          handleRealtimeChange("lootHistory", payload);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_raids" },
        (payload) => {
          if (saving.current) return;
          handleRealtimeChange("scheduled", payload);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleRealtimeChange = (table, payload) => {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    const transformFn = {
      raiders: transformRaiderFromDb,
      raidHistory: transformRaidFromDb,
      lootHistory: transformLootFromDb,
      scheduled: transformScheduledFromDb,
    }[table];

    const setFn = {
      raiders: setRaiders,
      raidHistory: setRaidHistory,
      lootHistory: setLootHistory,
      scheduled: setScheduled,
    }[table];

    if (eventType === "INSERT") {
      setFn(prev => {
        // Avoid duplicates
        if (prev.some(item => item.id === newRecord.id)) return prev;
        return [transformFn(newRecord), ...prev];
      });
    } else if (eventType === "UPDATE") {
      setFn(prev => prev.map(item => 
        item.id === newRecord.id ? transformFn(newRecord) : item
      ));
    } else if (eventType === "DELETE") {
      setFn(prev => prev.filter(item => item.id !== oldRecord.id));
    }
  };

  // ============================================================================
  // DATA TRANSFORMATION HELPERS (snake_case <-> camelCase)
  // ============================================================================
  
  function transformRaiderFromDb(r) {
    return {
      id: r.id,
      name: r.name,
      class: r.class,
      rank: r.rank,
      dkp: r.dkp,
      raidCount: r.raid_count,
      createdAt: r.created_at,
    };
  }

  function transformRaiderToDb(r) {
    return {
      id: r.id,
      name: r.name,
      class: r.class,
      rank: r.rank,
      dkp: r.dkp,
      raid_count: r.raidCount ?? 0,
      created_at: r.createdAt ?? new Date().toISOString(),
    };
  }

  function transformRaidFromDb(r) {
    return {
      id: r.id,
      raidType: r.raid_type,
      bossesKilled: r.bosses_killed || [],
      progBosses: r.prog_bosses || [],
      participants: r.participants || [],
      dkpAwarded: r.dkp_awarded,
      warcraftLogsUrl: r.warcraft_logs_url || '',
      completedAt: r.completed_at,
      editHistory: r.edit_history || [],
    };
  }

  function transformRaidToDb(r) {
    return {
      id: r.id,
      raid_type: r.raidType,
      bosses_killed: r.bossesKilled || [],
      prog_bosses: r.progBosses || [],
      participants: r.participants || [],
      dkp_awarded: r.dkpAwarded ?? false,
      warcraft_logs_url: r.warcraftLogsUrl || null,
      completed_at: r.completedAt ?? new Date().toISOString(),
    };
  }

  function transformLootFromDb(l) {
    return {
      id: l.id,
      raidId: l.raid_id,
      itemName: l.item_name,
      wowheadId: l.wowhead_id,
      winnerId: l.winner_id,
      category: l.category,
      isBis: l.is_bis,
      dkpCost: l.dkp_cost,
      timestamp: l.timestamp,
    };
  }

  function transformLootToDb(l) {
    return {
      id: l.id,
      raid_id: l.raidId || null,
      item_name: l.itemName,
      wowhead_id: l.wowheadId || null,
      winner_id: l.winnerId,
      category: l.category,
      is_bis: l.isBis ?? true,
      dkp_cost: l.dkpCost ?? 0,
      timestamp: l.timestamp ?? new Date().toISOString(),
    };
  }

  function transformScheduledFromDb(s) {
    return {
      id: s.id,
      raidType: s.raid_type,
      dateTime: s.date_time,
      notes: s.note || '',
      roster: s.roster || [],
      createdAt: s.created_at,
    };
  }

  function transformScheduledToDb(s) {
    return {
      id: s.id,
      raid_type: s.raidType,
      date_time: s.dateTime,
      note: s.notes || null,
      roster: s.roster || [],
      created_at: s.createdAt ?? new Date().toISOString(),
    };
  }

  // ============================================================================
  // RAIDERS OPERATIONS
  // ============================================================================

  const addRaider = useCallback(async (raider) => {
    setError(null);
    const dbRaider = transformRaiderToDb(raider);
    
    // Optimistic update
    setRaiders(prev => [...prev, raider]);
    
    saving.current = true;
    const { error } = await supabase.from("raiders").insert(dbRaider);
    saving.current = false;
    
    if (error) {
      setError(error.message);
      // Rollback on error
      setRaiders(prev => prev.filter(r => r.id !== raider.id));
    }
  }, []);

  const updateRaider = useCallback(async (id, updates) => {
    setError(null);
    
    // Transform updates to db format
    const dbUpdates = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.class !== undefined) dbUpdates.class = updates.class;
    if (updates.rank !== undefined) dbUpdates.rank = updates.rank;
    if (updates.dkp !== undefined) dbUpdates.dkp = updates.dkp;
    if (updates.raidCount !== undefined) dbUpdates.raid_count = updates.raidCount;

    // Optimistic update
    setRaiders(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    
    saving.current = true;
    const { error } = await supabase.from("raiders").update(dbUpdates).eq("id", id);
    saving.current = false;
    
    if (error) {
      setError(error.message);
      // Could add rollback here if needed
    }
  }, []);

  const deleteRaider = useCallback(async (id) => {
    setError(null);
    
    // Store for potential rollback
    const raiderToDelete = raiders.find(r => r.id === id);
    
    // Optimistic update
    setRaiders(prev => prev.filter(r => r.id !== id));
    
    saving.current = true;
    const { error } = await supabase.from("raiders").delete().eq("id", id);
    saving.current = false;
    
    if (error) {
      setError(error.message);
      // Rollback
      if (raiderToDelete) {
        setRaiders(prev => [...prev, raiderToDelete]);
      }
    }
  }, [raiders]);

  const bulkUpdateRaiders = useCallback(async (updates) => {
    // updates is array of { id, ...fieldsToUpdate }
    setError(null);
    
    // Optimistic update
    setRaiders(prev => prev.map(r => {
      const update = updates.find(u => u.id === r.id);
      return update ? { ...r, ...update } : r;
    }));

    saving.current = true;
    
    // Perform all updates
    const promises = updates.map(({ id, ...fields }) => {
      const dbFields = {};
      if (fields.dkp !== undefined) dbFields.dkp = fields.dkp;
      if (fields.raidCount !== undefined) dbFields.raid_count = fields.raidCount;
      if (fields.rank !== undefined) dbFields.rank = fields.rank;
      if (fields.name !== undefined) dbFields.name = fields.name;
      if (fields.class !== undefined) dbFields.class = fields.class;
      return supabase.from("raiders").update(dbFields).eq("id", id);
    });
    
    const results = await Promise.all(promises);
    saving.current = false;
    
    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
      setError(errors.map(e => e.error.message).join(", "));
    }
  }, []);

  // ============================================================================
  // RAID HISTORY OPERATIONS
  // ============================================================================

  const addRaid = useCallback(async (raid) => {
    setError(null);
    const dbRaid = transformRaidToDb(raid);
    
    // Optimistic update
    setRaidHistory(prev => [raid, ...prev]);
    
    saving.current = true;
    const { error } = await supabase.from("raid_history").insert(dbRaid);
    saving.current = false;
    
    if (error) {
      setError(error.message);
      setRaidHistory(prev => prev.filter(r => r.id !== raid.id));
    }
  }, []);

  const updateRaid = useCallback(async (id, updates) => {
    setError(null);
    
    const dbUpdates = {};
    if (updates.bossesKilled !== undefined) dbUpdates.bosses_killed = updates.bossesKilled;
    if (updates.progBosses !== undefined) dbUpdates.prog_bosses = updates.progBosses;
    if (updates.participants !== undefined) dbUpdates.participants = updates.participants;
    if (updates.dkpAwarded !== undefined) dbUpdates.dkp_awarded = updates.dkpAwarded;

    setRaidHistory(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    
    saving.current = true;
    const { error } = await supabase.from("raid_history").update(dbUpdates).eq("id", id);
    saving.current = false;
    
    if (error) setError(error.message);
  }, []);

  // ============================================================================
  // LOOT HISTORY OPERATIONS
  // ============================================================================

  const addLoot = useCallback(async (loot) => {
    setError(null);
    const dbLoot = transformLootToDb(loot);
    
    // Optimistic update
    setLootHistory(prev => [loot, ...prev]);
    
    saving.current = true;
    const { error } = await supabase.from("loot_history").insert(dbLoot);
    saving.current = false;
    
    if (error) {
      setError(error.message);
      setLootHistory(prev => prev.filter(l => l.id !== loot.id));
    }
  }, []);

  // ============================================================================
  // SCHEDULED RAIDS OPERATIONS
  // ============================================================================

  const addScheduledRaid = useCallback(async (raid) => {
    setError(null);
    const dbRaid = transformScheduledToDb(raid);
    
    setScheduled(prev => [...prev, raid].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime)));
    
    saving.current = true;
    const { error } = await supabase.from("scheduled_raids").insert(dbRaid);
    saving.current = false;
    
    if (error) {
      setError(error.message);
      setScheduled(prev => prev.filter(r => r.id !== raid.id));
    }
  }, []);

  const updateScheduledRaid = useCallback(async (id, updates) => {
    setError(null);
    
    const dbUpdates = {};
    if (updates.raidType !== undefined) dbUpdates.raid_type = updates.raidType;
    if (updates.dateTime !== undefined) dbUpdates.date_time = updates.dateTime;
    if (updates.notes !== undefined) dbUpdates.note = updates.notes;
    if (updates.roster !== undefined) dbUpdates.roster = updates.roster;

    setScheduled(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    
    saving.current = true;
    const { error } = await supabase.from("scheduled_raids").update(dbUpdates).eq("id", id);
    saving.current = false;
    
    if (error) setError(error.message);
  }, []);

  const deleteScheduledRaid = useCallback(async (id) => {
    setError(null);
    
    const toDelete = scheduled.find(r => r.id === id);
    setScheduled(prev => prev.filter(r => r.id !== id));
    
    saving.current = true;
    const { error } = await supabase.from("scheduled_raids").delete().eq("id", id);
    saving.current = false;
    
    if (error) {
      setError(error.message);
      if (toDelete) setScheduled(prev => [...prev, toDelete]);
    }
  }, [scheduled]);

  // ============================================================================
  // RETURN API
  // ============================================================================
  
  return {
    // Data
    raiders,
    raidHistory,
    lootHistory,
    scheduled,
    loading,
    error,
    
    // Raiders operations
    addRaider,
    updateRaider,
    deleteRaider,
    bulkUpdateRaiders,
    
    // Raid history operations
    addRaid,
    updateRaid,
    
    // Loot operations
    addLoot,
    
    // Scheduled raids operations
    addScheduledRaid,
    updateScheduledRaid,
    deleteScheduledRaid,
  };
}
