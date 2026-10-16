package com.nova.jeansmixing

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** One size line: waist/length are kept as raw 2-digit strings ("00" length = ODD). */
data class SizeEntry(var waist: String, var length: String, var quantity: Int) {
    fun displaySize(): String =
        if (length == "00") "${waist}xODD" else "${waist}x$length"
}

data class Project(
    val fileName: String,
    var name: String,
    val createdAt: Long,
    var locked: Boolean,
    val entries: MutableList<SizeEntry>,
    /** Part 2: append-only log of +1/+5/+10 presses. */
    val placingEvents: MutableList<PressEvent> = mutableListOf(),
    /** Part 2: per-size history timeline rows. */
    val timeline: MutableList<TimelineEntry> = mutableListOf(),
    /** Part 2: indices of sizes finished via the per-size Done button. */
    val doneSizes: MutableSet<Int> = mutableSetOf(),
    /**
     * Round 3: box count frozen at lock time. The plan total can stop being
     * divisible by 25 after overplacement cascades (the excess pairs physically
     * exist but later "needed" labels shrink), so the physical box count must
     * not be re-derived from the plan afterwards. 0 = unset (old projects).
     */
    var lockedBoxCount: Int = 0,
    /** Round 3: per-size stapled price-tag counts (parallel to entries). */
    val stapled: MutableList<Int> = mutableListOf()
)

/** Projects persist as small JSON files in the app's private storage. */
object ProjectStore {

    private fun dir(context: Context): File =
        File(context.filesDir, "projects").apply { mkdirs() }

    fun list(context: Context): List<Project> {
        val files = dir(context).listFiles { f -> f.extension == "json" } ?: return emptyList()
        return files.mapNotNull { loadFile(it) }.sortedByDescending { it.createdAt }
    }

    fun load(context: Context, fileName: String): Project? =
        loadFile(File(dir(context), fileName))

    private fun loadEvents(o: JSONObject): MutableList<PressEvent> {
        val out = mutableListOf<PressEvent>()
        val arr = o.optJSONArray("placingEvents") ?: return out
        for (i in 0 until arr.length()) {
            val e = arr.getJSONObject(i)
            out.add(PressEvent(e.getInt("size"), e.getInt("count"), e.getLong("t")))
        }
        return out
    }

    private fun loadTimeline(o: JSONObject): MutableList<TimelineEntry> {
        val out = mutableListOf<TimelineEntry>()
        val arr = o.optJSONArray("timeline") ?: return out
        for (i in 0 until arr.length()) {
            val e = arr.getJSONObject(i)
            out.add(TimelineEntry(e.getInt("size"), e.getLong("t"), e.getString("text")))
        }
        return out
    }

    private fun loadDoneSizes(o: JSONObject): MutableSet<Int> {
        val out = mutableSetOf<Int>()
        val arr = o.optJSONArray("doneSizes") ?: return out
        for (i in 0 until arr.length()) out.add(arr.getInt(i))
        return out
    }

    private fun loadStapled(o: JSONObject, size: Int): MutableList<Int> {
        val out = mutableListOf<Int>()
        val arr = o.optJSONArray("stapled")
        if (arr != null) for (i in 0 until arr.length()) out.add(arr.optInt(i))
        while (out.size < size) out.add(0)
        return out
    }

    private fun loadFile(f: File): Project? {
        return try {
            val o = JSONObject(f.readText())
            val entries = mutableListOf<SizeEntry>()
            val arr = o.optJSONArray("entries") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val e = arr.getJSONObject(i)
                entries.add(SizeEntry(e.getString("waist"), e.getString("length"), e.getInt("qty")))
            }
            Project(
                fileName = f.name,
                name = o.getString("name"),
                createdAt = o.getLong("createdAt"),
                locked = o.optBoolean("locked", false),
                entries = entries,
                placingEvents = loadEvents(o),
                timeline = loadTimeline(o),
                doneSizes = loadDoneSizes(o),
                lockedBoxCount = o.optInt("lockedBoxCount", 0),
                stapled = loadStapled(o, entries.size)
            )
        } catch (e: Exception) {
            null
        }
    }

    fun save(context: Context, project: Project) {
        val o = JSONObject()
        o.put("name", project.name)
        o.put("createdAt", project.createdAt)
        o.put("locked", project.locked)
        val arr = JSONArray()
        for (e in project.entries) {
            arr.put(
                JSONObject()
                    .put("waist", e.waist)
                    .put("length", e.length)
                    .put("qty", e.quantity)
            )
        }
        o.put("entries", arr)
        val earr = JSONArray()
        for (e in project.placingEvents) {
            earr.put(
                JSONObject()
                    .put("size", e.sizeIdx)
                    .put("count", e.count)
                    .put("t", e.timeMs)
            )
        }
        o.put("placingEvents", earr)
        val tarr = JSONArray()
        for (t in project.timeline) {
            tarr.put(
                JSONObject()
                    .put("size", t.sizeIdx)
                    .put("t", t.timeMs)
                    .put("text", t.text)
            )
        }
        o.put("timeline", tarr)
        val darr = JSONArray()
        for (d in project.doneSizes) darr.put(d)
        o.put("doneSizes", darr)
        o.put("lockedBoxCount", project.lockedBoxCount)
        val sarr = JSONArray()
        for (s in project.stapled) sarr.put(s)
        o.put("stapled", sarr)
        File(dir(context), project.fileName).writeText(o.toString())
    }

    /** Creates a new project auto-named with the current date + time (unique). */
    fun create(context: Context): Project {
        val now = System.currentTimeMillis()
        val base = SimpleDateFormat("MMM d, yyyy h:mm a", Locale.US).format(Date(now))
        val existingNames = list(context).map { it.name }.toSet()
        var name = base
        var n = 2
        while (name in existingNames) {
            name = "$base ($n)"
            n++
        }
        val fileName = "proj_${now}_${(0..99999).random()}.json"
        val project = Project(fileName, name, now, false, mutableListOf())
        save(context, project)
        return project
    }

    fun delete(context: Context, project: Project) {
        File(dir(context), project.fileName).delete()
    }
}
