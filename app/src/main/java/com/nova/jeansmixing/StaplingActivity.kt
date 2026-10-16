package com.nova.jeansmixing

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * Round 3 — stapling screen for ONE size (price tags).
 *
 * Shows "X out of Y placed, staple Z more" plus a number box. Deliberately has
 * NO +1/+5/+10 buttons, so a stray tap can't wreck the count. Done records the
 * amount and returns to the placing screen; the system back button cancels
 * without recording anything.
 */
class StaplingActivity : AppCompatActivity() {

    private var fileName: String? = null
    private var sizeIdx: Int = -1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_stapling)

        val fn = intent.getStringExtra("projectFile")
        val si = intent.getIntExtra("sizeIdx", -1)
        val project = if (fn != null) ProjectStore.load(this, fn) else null
        if (project == null || si !in project.entries.indices) {
            finish()
            return
        }
        fileName = fn
        sizeIdx = si

        val entry = project.entries[sizeIdx]
        val placed = DealLogic.replay(project).placedPerSize[sizeIdx]
        val needed = entry.quantity
        val stapled = project.stapled.getOrElse(sizeIdx) { 0 }
        val z = maxOf(0, needed - stapled)

        val sizeLabel = "${entry.waist} x ${if (entry.length == "00") "ODD" else entry.length}"
        findViewById<TextView>(R.id.stapleTitle).text = sizeLabel
        findViewById<TextView>(R.id.stapleLine).text =
            "$placed out of $needed placed, staple $z more"

        val input = findViewById<EditText>(R.id.stapleInput)
        input.hint = z.toString()

        findViewById<Button>(R.id.stapleDone).setOnClickListener {
            val raw = input.text.toString()
            // Blank (or junk) = assume all remaining.
            val n = if (raw.isBlank()) z else raw.toIntOrNull()?.coerceIn(0, z) ?: z
            if (n < z) {
                AlertDialog.Builder(this)
                    .setTitle("Stapling")
                    .setMessage("You stapled $n out of $z. Are you sure?")
                    .setPositiveButton("Yes") { _, _ ->
                        record(n)
                        finish()
                    }
                    .setNegativeButton("No", null)
                    .show()
            } else {
                record(n)
                finish()
            }
        }
    }

    private fun record(n: Int) {
        if (n <= 0) return
        val fn = fileName ?: return
        val project = ProjectStore.load(this, fn) ?: return
        while (project.stapled.size <= sizeIdx) project.stapled.add(0)
        project.stapled[sizeIdx] += n
        project.timeline.add(
            TimelineEntry(sizeIdx, System.currentTimeMillis(), "$n stapled")
        )
        ProjectStore.save(this, project)
    }
}
