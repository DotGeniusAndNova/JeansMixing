package com.nova.jeansmixing

import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Contents of one box, recomputed LIVE every time it opens
 * (DealLogic.simulateLive): ACTUAL placements from the event log, PLUS the
 * remaining plan from the current next-box pointer. Never a cached snapshot,
 * so shortfall/overplacement cascades and corrections are always reflected.
 */
class BoxDetailActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_box_detail)

        val fileName = intent.getStringExtra("projectFile")
        val boxIdx = intent.getIntExtra("boxIdx", 0)
        if (fileName == null) {
            finish()
            return
        }
        val project = ProjectStore.load(this, fileName)
        if (project == null) {
            finish()
            return
        }
        val boxes = DealLogic.simulateLive(project)
        if (boxIdx !in boxes.indices) {
            finish()
            return
        }

        findViewById<TextView>(R.id.boxTitle).text = "Box ${boxIdx + 1} of ${boxes.size}"

        val rows = findViewById<LinearLayout>(R.id.boxRows)
        addRow(rows, "Pair", "Size", "Bundle", "Layer", header = true)

        val contents = boxes[boxIdx]
        for ((p, sizeIdx) in contents.withIndex()) {
            val entry = project.entries[sizeIdx]
            val size = if (entry.length == "00") "${entry.waist}xODD" else "${entry.waist}x${entry.length}"
            val (bundle, layer) = if (p < DealLogic.BOX_CAPACITY - 1) {
                "${p / DealLogic.BUNDLE_SIZE + 1}" to "${p % DealLogic.BUNDLE_SIZE + 1}"
            } else {
                "–" to "top"
            }
            addRow(rows, "${p + 1}", size, bundle, layer, header = false, alt = p % 2 == 1)
        }

        findViewById<Button>(R.id.boxBack).setOnClickListener { finish() }
    }

    private fun addRow(
        parent: LinearLayout,
        pair: String,
        size: String,
        bundle: String,
        layer: String,
        header: Boolean,
        alt: Boolean = false
    ) {
        val row = layoutInflater.inflate(R.layout.row_box, parent, false)
        if (alt) row.setBackgroundColor(getColor(R.color.row_yellow))
        val pairView = row.findViewById<TextView>(R.id.boxPair)
        val sizeView = row.findViewById<TextView>(R.id.boxSize)
        val bundleView = row.findViewById<TextView>(R.id.boxBundle)
        val layerView = row.findViewById<TextView>(R.id.boxLayer)
        pairView.text = pair
        sizeView.text = size
        bundleView.text = bundle
        layerView.text = layer
        if (header) {
            pairView.setTypeface(pairView.typeface, android.graphics.Typeface.BOLD)
            sizeView.setTypeface(sizeView.typeface, android.graphics.Typeface.BOLD)
            bundleView.setTypeface(bundleView.typeface, android.graphics.Typeface.BOLD)
            layerView.setTypeface(layerView.typeface, android.graphics.Typeface.BOLD)
        }
        parent.addView(row)
    }
}
