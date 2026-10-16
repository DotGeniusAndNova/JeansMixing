package com.nova.jeansmixing

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * Single-page entry screen: [waist] x [length], quantity field, custom number pad.
 * No system keyboard here — everything goes through the pad.
 */
class EntryActivity : AppCompatActivity() {

    private lateinit var project: Project

    /** Which saved entry we're viewing; entries.size means "new blank entry". */
    private var index = 0

    private val waistBuf = StringBuilder()
    private val lengthBuf = StringBuilder()
    private val qtyBuf = StringBuilder()

    /** 0 = waist, 1 = length, 2 = quantity */
    private var focused = 0

    private lateinit var waistField: TextView
    private lateinit var lengthField: TextView
    private lateinit var qtyField: TextView
    private lateinit var leftArrow: Button
    private lateinit var rightArrow: Button
    private lateinit var enterButton: Button
    private lateinit var entryCounter: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_entry)

        val fileName = intent.getStringExtra("projectFile")
        if (fileName == null) {
            finish()
            return
        }
        val loaded = ProjectStore.load(this, fileName)
        if (loaded == null) {
            finish()
            return
        }
        project = loaded
        if (project.locked) {
            // Safety net: locked projects are never editable.
            startActivity(Intent(this, LockedActivity::class.java).putExtra("projectFile", fileName))
            finish()
            return
        }
        index = project.entries.size

        waistField = findViewById(R.id.waistField)
        lengthField = findViewById(R.id.lengthField)
        qtyField = findViewById(R.id.qtyField)
        leftArrow = findViewById(R.id.leftArrow)
        rightArrow = findViewById(R.id.rightArrow)
        enterButton = findViewById(R.id.padEnter)
        entryCounter = findViewById(R.id.entryCounter)
        findViewById<TextView>(R.id.projectName).text = project.name

        // Tap a field: clear it and select it (you were going to erase it anyway).
        waistField.setOnClickListener { clearAndFocus(0) }
        lengthField.setOnClickListener { clearAndFocus(1) }
        qtyField.setOnClickListener { clearAndFocus(2) }

        val digits = mapOf(
            R.id.pad0 to "0", R.id.pad1 to "1", R.id.pad2 to "2",
            R.id.pad3 to "3", R.id.pad4 to "4", R.id.pad5 to "5",
            R.id.pad6 to "6", R.id.pad7 to "7", R.id.pad8 to "8",
            R.id.pad9 to "9"
        )
        for ((id, d) in digits) {
            findViewById<Button>(id).setOnClickListener { onDigit(d) }
        }
        findViewById<Button>(R.id.padBack).setOnClickListener { onBackspace() }
        enterButton.setOnClickListener { onNext() }

        leftArrow.setOnClickListener { onPrevEntry() }
        rightArrow.setOnClickListener { onNext() }
        findViewById<Button>(R.id.doneButton).setOnClickListener { onDone() }

        render()
    }

    private fun clearAndFocus(f: Int) {
        when (f) {
            0 -> waistBuf.clear()
            1 -> lengthBuf.clear()
            2 -> qtyBuf.clear()
        }
        focused = f
        render()
    }

    private fun onDigit(d: String) {
        when (focused) {
            0 -> if (waistBuf.length < 2) {
                waistBuf.append(d)
                if (waistBuf.length == 2) focused = 1
            }
            1 -> if (lengthBuf.length < 2) {
                lengthBuf.append(d)
                if (lengthBuf.length == 2) focused = 2
            }
            2 -> qtyBuf.append(d)
        }
        render()
    }

    private fun onBackspace() {
        val buf = when (focused) {
            0 -> waistBuf
            1 -> lengthBuf
            else -> qtyBuf
        }
        if (buf.isNotEmpty()) {
            buf.deleteCharAt(buf.length - 1)
        } else if (focused > 0) {
            // Blank field + backspace = jump to the previous field.
            focused--
        }
        render()
    }

    private fun entryComplete(): Boolean =
        waistBuf.length == 2 && lengthBuf.length == 2 && qtyBuf.isNotEmpty()

    /** Right arrow / Enter: commit the current entry, then move to the next one. */
    private fun onNext() {
        if (!entryComplete()) return
        if (!tryCommit()) return // duplicate warning shown; stay put
        index++
        if (index < project.entries.size) loadEntry(index) else clearBuffers()
        focused = 0
        render()
    }

    /**
     * Saves the buffered entry (adding or replacing at [index]).
     * Returns false if a duplicate warning was shown (nothing saved).
     */
    private fun tryCommit(): Boolean {
        val w = waistBuf.toString()
        val l = lengthBuf.toString()
        val q = qtyBuf.toString().toIntOrNull() ?: return true
        for (i in project.entries.indices) {
            if (i != index && project.entries[i].waist == w && project.entries[i].length == l) {
                AlertDialog.Builder(this)
                    .setTitle("Duplicate size")
                    .setMessage("${displaySize(w, l)} is already in the list.")
                    .setPositiveButton("OK", null)
                    .show()
                return false
            }
        }
        val entry = SizeEntry(w, l, q)
        if (index < project.entries.size) project.entries[index] = entry
        else project.entries.add(entry)
        ProjectStore.save(this, project)
        return true
    }

    /** Left arrow: page back to the previous entry with its values remembered. */
    private fun onPrevEntry() {
        if (index > 0) {
            index--
            loadEntry(index)
            focused = 0
            render()
        }
    }

    private fun loadEntry(i: Int) {
        val e = project.entries[i]
        waistBuf.clear()
        waistBuf.append(e.waist)
        lengthBuf.clear()
        lengthBuf.append(e.length)
        qtyBuf.clear()
        qtyBuf.append(e.quantity.toString())
    }

    private fun clearBuffers() {
        waistBuf.clear()
        lengthBuf.clear()
        qtyBuf.clear()
    }

    private fun displaySize(w: String, l: String): String =
        if (l == "00") "${w}xODD" else "${w}x$l"

    private fun render() {
        waistField.text = waistBuf.toString()
        // "00" in the LENGTH field shows as ODD (waist "00" stays as-is).
        lengthField.text = if (lengthBuf.toString() == "00") "ODD" else lengthBuf.toString()
        qtyField.text = qtyBuf.toString()

        waistField.isSelected = focused == 0
        lengthField.isSelected = focused == 1
        qtyField.isSelected = focused == 2

        // Next/Enter stay greyed out until the entry is complete.
        val canNext = entryComplete()
        rightArrow.isEnabled = canNext
        rightArrow.alpha = if (canNext) 1f else 0.35f
        enterButton.isEnabled = canNext
        enterButton.alpha = if (canNext) 1f else 0.35f

        leftArrow.isEnabled = index > 0
        leftArrow.alpha = if (index > 0) 1f else 0.35f

        entryCounter.text = when {
            index < project.entries.size -> "Entry ${index + 1} of ${project.entries.size}"
            project.entries.isEmpty() -> "Entry 1"
            else -> "Entry ${project.entries.size + 1} (new)"
        }
    }

    private fun onDone() {
        // Safety: commit a finished-but-unsaved entry before leaving.
        if (entryComplete()) {
            if (!tryCommit()) return
            index = project.entries.size
            clearBuffers()
            focused = 0
        }
        if (project.entries.isEmpty()) {
            Toast.makeText(this, "Add at least one size first", Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(
            Intent(this, ReviewActivity::class.java).putExtra("projectFile", project.fileName)
        )
    }
}
